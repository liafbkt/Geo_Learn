"""Rebuild processing inputs from pinned official archives, never alter source bytes.

Requires Python 3.12, pypdf 5+ and pyproj 3.7.2. See README.md.
"""
from pathlib import Path
import csv
import hashlib
import io
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / '.tools'))
from pypdf import PdfReader
from pyproj import Transformer, network
network.set_network_enabled(False)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8', newline='\n')

PINNED = {
    'cb_2025_us_state_20m.zip': 'efddd884f1442ef233b1ba9c12dddbd66b6fdf94da6a373e1556aefe3dbc5751',
    '2025_Gaz_place_national.zip': '49644173a453469d9bd77fb7a493b027f87567e209edaf2078aac7543ac2ee29',
    'gpo-states-capitals.pdf': '2f832de6bf5a2ebcb5ffd9f79939e0bb41da2f53d09a8f2fb99ffe2c605b1f9f',
    'census-tiger2025-techdoc.pdf': '21476bdba82fe8072f8994ae59bda484260d1b932c13f31991f6414f8e04d551',
    'govinfo-about.html': '6794de83f2aead8c0dfe8806ce82c630a1fb6a770c5924dab66c1ca6ac326a05',
}
for filename, expected_hash in PINNED.items():
    assert digest(HERE / filename) == expected_hash, f'Pinned source changed: {filename}'

# Editorial Chinese translations, keyed to official USPS codes. English state names
# are read from Census KML and capital associations from the pinned GPO publication.
translations = '''AL|阿拉巴马州|蒙哥马利
AK|阿拉斯加州|朱诺
AZ|亚利桑那州|菲尼克斯
AR|阿肯色州|小石城
CA|加利福尼亚州|萨克拉门托
CO|科罗拉多州|丹佛
CT|康涅狄格州|哈特福德
DE|特拉华州|多佛
FL|佛罗里达州|塔拉哈西
GA|佐治亚州|亚特兰大
HI|夏威夷州|檀香山
ID|爱达荷州|博伊西
IL|伊利诺伊州|斯普林菲尔德
IN|印第安纳州|印第安纳波利斯
IA|艾奥瓦州|得梅因
KS|堪萨斯州|托皮卡
KY|肯塔基州|法兰克福
LA|路易斯安那州|巴吞鲁日
ME|缅因州|奥古斯塔
MD|马里兰州|安纳波利斯
MA|马萨诸塞州|波士顿
MI|密歇根州|兰辛
MN|明尼苏达州|圣保罗
MS|密西西比州|杰克逊
MO|密苏里州|杰斐逊城
MT|蒙大拿州|海伦娜
NE|内布拉斯加州|林肯
NV|内华达州|卡森城
NH|新罕布什尔州|康科德
NJ|新泽西州|特伦顿
NM|新墨西哥州|圣菲
NY|纽约州|奥尔巴尼
NC|北卡罗来纳州|罗利
ND|北达科他州|俾斯麦
OH|俄亥俄州|哥伦布
OK|俄克拉何马州|俄克拉何马城
OR|俄勒冈州|塞勒姆
PA|宾夕法尼亚州|哈里斯堡
RI|罗得岛州|普罗维登斯
SC|南卡罗来纳州|哥伦比亚
SD|南达科他州|皮尔
TN|田纳西州|纳什维尔
TX|得克萨斯州|奥斯汀
UT|犹他州|盐湖城
VT|佛蒙特州|蒙彼利埃
VA|弗吉尼亚州|里士满
WA|华盛顿州|奥林匹亚
WV|西弗吉尼亚州|查尔斯顿
WI|威斯康星州|麦迪逊
WY|怀俄明州|夏延'''
zh = {code: (state, capital) for code, state, capital in (line.split('|') for line in translations.splitlines())}
assert len(zh) == 50
pdf_text = unicodedata.normalize('NFKC', '\n'.join(page.extract_text() for page in PdfReader(HERE / 'gpo-states-capitals.pdf').pages))
gpo = {code: capital.strip() for _, code, capital in re.findall(r'([A-Z][A-Z ]+) \(([A-Z]{2})\)[^\n]*\nCapital: ([^\n]+)', pdf_text)}
assert set(zh) <= set(gpo)
with zipfile.ZipFile(HERE / 'cb_2025_us_state_20m.zip') as archive:
    kml_bytes = archive.read('cb_2025_us_state_20m.kml')
with zipfile.ZipFile(HERE / '2025_Gaz_place_national.zip') as archive:
    gaz_bytes = archive.read('2025_Gaz_place_national.txt')
gaz = list(csv.DictReader(io.StringIO(gaz_bytes.decode('utf-8-sig')), delimiter='|'))
ns = {'k': 'http://www.opengis.net/kml/2.2'}
features, entities, points_audit, orientations = [], [], [], []
transformer = Transformer.from_crs('EPSG:4269', 'EPSG:4326', always_xy=True, allow_ballpark=False)
def ring(element, clockwise):
    coords = [[float(x) for x in token.split(',')[:2]] for token in element.find('.//k:coordinates', ns).text.split()]
    assert coords[0] == coords[-1]
    # Census splits the antimeridian; no longitude shifts or wrap are applied.
    assert all(abs(a[0] - b[0]) <= 180 for a, b in zip(coords, coords[1:]))
    signed_area = sum(a[0]*b[1] - b[0]*a[1] for a, b in zip(coords, coords[1:])) / 2
    reverse = (signed_area > 0) == clockwise
    if reverse:
        coords.reverse()
    orientations.append(reverse)
    return coords

for placemark in ET.fromstring(kml_bytes).findall('.//k:Placemark', ns):
    props = {node.attrib['name']: node.text for node in placemark.findall('.//k:SimpleData', ns)}
    code = props['STUSPS']
    if code not in zh:
        continue
    polygons = []
    for polygon in placemark.findall('.//k:Polygon', ns):
        outer = polygon.find('k:outerBoundaryIs', ns)
        polygons.append([ring(outer, True)] + [ring(inner, False) for inner in polygon.findall('k:innerBoundaryIs', ns)])
    state_id = 'us-' + code.lower()
    city_id = state_id + '-capital'
    features.append({'type': 'Feature', 'id': state_id, 'properties': {'id': state_id}, 'geometry': {'type': 'MultiPolygon', 'coordinates': polygons}})
    capital = 'Saint Paul' if code == 'MN' else gpo[code]
    gaz_name = {'HI': 'Urban Honolulu CDP', 'AK': 'Juneau city and borough', 'TN': 'Nashville-Davidson metropolitan government (balance)', 'IN': 'Indianapolis city (balance)', 'ID': 'Boise City city', 'MN': 'St. Paul city', 'NV': 'Carson City'}.get(code, capital + ' city')
    matches = [row for row in gaz if row['USPS'] == code and row['NAME'] == gaz_name]
    assert len(matches) == 1, (code, capital, gaz_name, [row['NAME'] for row in gaz if row['USPS'] == code and capital.lower() in row['NAME'].lower()])
    row = matches[0]
    raw_coord = [float(row['INTPTLONG']), float(row['INTPTLAT'])]
    coord = list(transformer.transform(*raw_coord))
    operation = transformer.get_last_used_operation()
    coord = [round(n, 9) for n in coord]
    points_audit.append({'state': code, 'GEOID': row['GEOID'], 'gazetteerName': gaz_name, 'gpoCapital': gpo[code], 'rawNAD83': raw_coord, 'WGS84': coord, 'operation': operation.description, 'definition': operation.definition, 'accuracyMetres': operation.accuracy})
    state_aliases = [code, zh[code][0].removesuffix('州')]
    state_aliases += {'CA': ['加州'], 'MA': ['麻省'], 'IA': ['爱荷华州', '爱荷华'], 'TX': ['德克萨斯州', '德州'], 'RI': ['罗德岛州']}.get(code, [])
    city_aliases = {'MN': ['St. Paul', 'St Paul'], 'HI': ['火奴鲁鲁'], 'AZ': ['凤凰城'], 'ID': ['Boise City']}.get(code, [])
    entities.append({'id': state_id, 'kind': 'region', 'names': {'zh': zh[code][0], 'en': props['NAME']}, 'aliases': state_aliases, 'capitalId': city_id, 'capabilities': ['locate_region', 'identify_region', 'associate_capital']})
    entities.append({'id': city_id, 'kind': 'place', 'names': {'zh': zh[code][1], 'en': capital}, 'aliases': city_aliases, 'parentId': state_id, 'coordinate': coord, 'capabilities': ['locate_place', 'identify_place']})
assert len(features) == 50 and len(entities) == 100
write('regions.geojson', {'type': 'FeatureCollection', 'features': sorted(features, key=lambda f: f['id'])})
write('entities.input.json', sorted(entities, key=lambda e: e['id']))
write('points-audit.json', sorted(points_audit, key=lambda p: p['state']))
write('manifest.template.json', {'schemaVersion': 1, 'contentVersion': '1.0.0-dev.1', 'packId': 'us-states', 'title': {'zh': '美国50州与州府', 'en': 'US States and Capitals'}, 'primaryAnswerLanguage': 'en', 'expectedEntityCounts': {'region': 50, 'place': 50}, 'capabilities': ['locate_region', 'identify_region', 'associate_capital', 'locate_place', 'identify_place'], 'defaultViewport': {'center': [-98, 39], 'scale': 800}, 'distributionStatus': 'development-only'})
inputs = [
    ('cb_2025_us_state_20m.zip', 'U.S. Census Bureau', 'https://www2.census.gov/geo/tiger/GENZ2025/kml/cb_2025_us_state_20m.zip', 'WGS84 KML longitude/latitude (EPSG:4326)'),
    ('2025_Gaz_place_national.zip', 'U.S. Census Bureau', 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip', 'NAD83 (EPSG:4269)'),
    ('gpo-states-capitals.pdf', 'U.S. Government Publishing Office', 'https://www.govinfo.gov/content/pkg/GPO-STYLEMANUAL-2016/pdf/GPO-STYLEMANUAL-2016-20.pdf', 'not applicable'),
    ('census-tiger2025-techdoc.pdf', 'U.S. Census Bureau', 'https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc.pdf', 'not applicable; documents NAD83 source data'),
    ('govinfo-about.html', 'U.S. Government Publishing Office', 'https://www.govinfo.gov/about', 'not applicable'),
]
ledger = [{'file': file, 'organization': org, 'url': url, 'retrievedAt': '2026-08-30', 'sha256': digest(HERE/file), 'coordinateReferenceSystem': crs, 'license': 'U.S. federal government work; public domain in the United States (17 USC 105)', 'licenseUrl': 'https://www.govinfo.gov/about'} for file, org, url, crs in inputs]
ledger[0]['license'] = 'Census archive ISO metadata: free to use in products/publications with Census acknowledgement; visual display at 1:20,000,000 or smaller scales only, not precise geographic analysis/geocoding.'
ledger[0]['licenseUrl'] = inputs[0][2] + '#cb_2025_us_state_20m.kml.iso.xml'
write('external-inputs.json', ledger)
steps = [{'operation': 'pin-authoritative-input', 'parameters': entry} for entry in ledger]
steps += [
    {'operation': 'extract-kml-and-select-50-states', 'parameters': {'kmlSha256': hashlib.sha256(kml_bytes).hexdigest(), 'outputSha256': digest(HERE/'regions.geojson'), 'filter': '50 USPS state codes; exclude DC and territories', 'geometryChanges': 'ring order only; preserve every source vertex, island, hole and antimeridian part', 'ringOrientation': 'D3: clockwise exteriors and counterclockwise holes', 'ringsReversed': sum(orientations)}},
    {'operation': 'join-official-capital-and-gazetteer', 'parameters': {'gazetteerTextSha256': hashlib.sha256(gaz_bytes).hexdigest(), 'sourceCRS': 'EPSG:4269', 'targetCRS': 'EPSG:4326', 'algorithm': 'pyproj 3.7.2 / PROJ Transformer.from_crs(always_xy=True,allow_ballpark=False); round to 9 decimals', 'auditSha256': digest(HERE/'points-audit.json'), 'entityOutputSha256': digest(HERE/'entities.input.json'), 'association': 'GPO 2016 Style Manual chapter 18; St. Paul canonicalized to Saint Paul', 'translations': 'editorial Simplified Chinese translations and accepted aliases'}}
]
write('source.input.json', {'id': 'us-census-2025-states-and-official-capitals', 'organization': 'U.S. Census Bureau; U.S. Government Publishing Office', 'url': inputs[0][2], 'retrievedAt': '2026-08-30', 'license': 'Census cartographic boundaries: free use with acknowledgement; intended small-scale display (1:20,000,000), not precise geographic analysis/geocoding. GPO government work: public domain in US (17 USC 105); https://www.govinfo.gov/about. See pinned archive ISO use constraints.', 'sha256': digest(HERE/'regions.geojson'), 'coordinateReferenceSystem': 'EPSG:4326', 'processing': steps, 'simplification': None, 'quantization': None, 'reviewIdentifier': None})
print(f'Prepared {len(features)} states, {len(entities)//2} capitals; reversed {sum(orientations)}/{len(orientations)} rings without changing vertices.')
