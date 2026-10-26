"""Faststream adapter: sitemap and detail-page parsing (trimmed real page, 2026-10-26)."""

from src.scrapers.faststream import parse_detail, parse_sitemap

SITEMAP = """<urlset>
<url><loc>https://www.faststream.com/job/marine-superintendent-lng-981899</loc></url>
<url><loc>https://www.faststream.com/job/marine-superintendent-lng-981899</loc></url>
<url><loc>https://www.faststream.com/job/personnel-assistant-979739</loc></url>
</urlset>"""

def page(salary: str) -> str:
    return f"""<html><body><nav>menu</nav><h1>Marine Superintendent (LNG)</h1>
<a>Back to Job Search</a><div>Job Details</div>
<dt>Posted:</dt><dd>1 day ago</dd><dt>Sector:</dt><dd>Shore-based Shipping &amp; Maritime</dd>
<dt>Location:</dt><dd>Asia-Pacific</dd><dt>Job Ref:</dt><dd>981899</dd>
<dt>Job Type:</dt><dd>Permanent</dd><dt>Salary:</dt><dd>{salary}</dd>
<dt>Expiry Date:</dt><dd>23 November 2026</dd><dt>Contact:</dt><dd>Jess Consultant</dd>
<dt>Contact Email:</dt><dd>jess.consultant@faststream.com</dd>
<h2>Job Description</h2><p>Oversee marine operations, safety and compliance for LNG vessels.</p>
<p>Requirements: Master Mariner with LNG experience.</p></body></html>"""


def test_sitemap_dedupes():
    assert parse_sitemap(SITEMAP) == [
        'https://www.faststream.com/job/marine-superintendent-lng-981899',
        'https://www.faststream.com/job/personnel-assistant-979739',
    ]


def test_detail_fields_and_no_contact_pii():
    job = parse_detail(page('Salary to commensurate with experience'), 'https://www.faststream.com/job/x-1')
    assert job['title'] == 'Marine Superintendent (LNG)'
    assert job['location'] == 'Asia-Pacific'
    assert job['requisition_id'] == '981899'
    assert job['employment_type_text'] == 'Permanent'
    assert 'Master Mariner' in job['description']
    assert '@' not in job['description'] and 'Jess' not in job['description']
    assert job['salary'] is None  # "commensurate" is not a stated amount


def test_stated_salary_is_kept():
    job = parse_detail(page('$9,000 - $11,000 per month'), 'https://www.faststream.com/job/x-1')
    assert job['salary'] == '$9,000 - $11,000 per month'


def test_page_without_description_is_dropped():
    assert parse_detail('<html><body><h1>x</h1></body></html>', 'u') is None
