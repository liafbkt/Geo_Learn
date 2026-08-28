# Map content release checklist

Complete one signed copy for each pack and release candidate. Automated validation supplies technical evidence only; it cannot complete or waive the human and legal checks below.

Pack ID: ____________________  Content version: ____________________

Release candidate commit: ____________________  Date: ____________________

## Automated evidence

- [ ] `pnpm content:validate -- <pack-directory>` exits successfully.
- [ ] A second transform from the same pinned inputs produces byte-identical files and SHA-256 values.
- [ ] Entity counts, references, capabilities, topology, bounds, points-in-regions and manifest checksums pass.
- [ ] Every raw source has an institution, direct URL, retrieval date, license/use terms, exact input hash and recorded processing chain.

## Required human review

- [ ] A reviewer compared the actual rendered map—not only source data—with the current authoritative standard map at all supported zoom levels.
- [ ] The representation, labels and boundaries involving Hong Kong, Macau and Taiwan were explicitly reviewed where applicable.
- [ ] A qualified reviewer documented whether statutory map review is required for the intended distribution channel and territory.
- [ ] When review or a standard-map identifier is required, its validity, displayed identifier and permitted scope were verified against the issuing authority.
- [ ] All third-party source licenses and attribution obligations were reviewed for redistribution inside the installer.
- [ ] Visual defects, disputed boundaries, missing islands/insets and label collisions were recorded and resolved or accepted by a named owner.

## Sign-off

Decision: [ ] approved for stated release  [ ] development-only  [ ] rejected

Reviewer name and role: ______________________________________________

Signature or auditable approval reference: _____________________________

Date: ____________________  Notes: ____________________________________
