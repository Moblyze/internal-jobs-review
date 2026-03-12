"""Certification extractor stub.

Extracts industry certifications mentioned in job descriptions.
TODO: Implement full keyword-based extraction logic.
"""


def extract_job_certifications(job_data: dict) -> list:
    """Extract certifications from job posting data.

    Args:
        job_data: Dict with 'description' and other job fields.

    Returns:
        List of certification strings found in the description.
    """
    description = job_data.get('description', '') or ''
    if not description:
        return []

    # Common energy/trades certifications to look for
    cert_keywords = [
        'CDL', 'OSHA 10', 'OSHA 30', 'TWIC', 'PMP', 'NACE',
        'API 510', 'API 570', 'API 653', 'AWS CWI', 'ASNT',
        'NCCER', 'NEBOSH', 'IOSH', 'SafeGulf', 'SafeLand',
        'H2S', 'First Aid', 'CPR', 'HAZWOPER',
        'PE License', 'EIT', 'CIH', 'CSP',
    ]

    found = []
    desc_upper = description.upper()
    for cert in cert_keywords:
        if cert.upper() in desc_upper:
            found.append(cert)

    return found
