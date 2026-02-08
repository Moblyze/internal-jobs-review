# Job Description Formatting - Before & After Examples

## Example 1: Baker Hughes Applications Engineer

### BEFORE
```
Raw text display with whitespace-pre-wrap:

ESSENTIAL RESPONSIBILITIES:
•    Ensure compliance with manage the Job Cycle (MtJC) process
•    Work with the assigned Service Delivery Coordinator/Salesperson to understand the client's well construction or production objectives as well as the commercial terms for Baker Hughes (i.e. outcome based contract, line item contract, etc.)
•    Perform offset job analysis and product/service specific engineering modelling calculations to understand application hazards and incident potential
•    Work together with all disciplines and stakeholders to ensure all aspects and constraints of the application and suggested products/services have been considered
•    Design a job program, including risk mitigation plans and contingency plans, that can meet the client's objective(s), maximize revenue potential and ensure future job assignments for Baker Hughes

QUALIFICATIONS/REQUIREMENTS:
•    Bachelor's degree in engineering
•    Excellent leadership, strong interpersonal, influencing and planning skills
•    Ability to be on call outside of normal business hours
•    Ability to work in a global matrix organization
•    Excellent communication and presentation skills
•    Strong organizational, analytical and problem solving skills
•    Must have the ability to travel (potential for travel to rig sites, customer facilities, meetings, training, etc.)

DESIRED CHARACTERISTICS:
•    Significant operational experience
•    Comfortable presenting in front of an audience of experienced peers
•    Ability to manage, develop, coach, and mentor teams across organizational boundaries
•    Ability to learn and use various computer tools to prepare data and visualizations for analysis
•    Ability to work independently

Reports To: Service Delivery Technical Manager

The Baker Hughes internal title for this role is: Applications Engineer I
```

### AFTER
```
Structured HTML rendering:
```

### Essential Responsibilities
- Ensure compliance with manage the Job Cycle (MtJC) process
- Work with the assigned Service Delivery Coordinator/Salesperson to understand the client's well construction or production objectives as well as the commercial terms for Baker Hughes (i.e. outcome based contract, line item contract, etc.)
- Perform offset job analysis and product/service specific engineering modelling calculations to understand application hazards and incident potential
- Work together with all disciplines and stakeholders to ensure all aspects and constraints of the application and suggested products/services have been considered
- Design a job program, including risk mitigation plans and contingency plans, that can meet the client's objective(s), maximize revenue potential and ensure future job assignments for Baker Hughes

### Qualifications/Requirements
- Bachelor's degree in engineering
- Excellent leadership, strong interpersonal, influencing and planning skills
- Ability to be on call outside of normal business hours
- Ability to work in a global matrix organization
- Excellent communication and presentation skills
- Strong organizational, analytical and problem solving skills
- Must have the ability to travel (potential for travel to rig sites, customer facilities, meetings, training, etc.)

### Desired Characteristics
- Significant operational experience
- Comfortable presenting in front of an audience of experienced peers
- Ability to manage, develop, coach, and mentor teams across organizational boundaries
- Ability to learn and use various computer tools to prepare data and visualizations for analysis
- Ability to work independently

Reports To: Service Delivery Technical Manager

The Baker Hughes internal title for this role is: Applications Engineer I

---

## Example 2: Location Formatting

### BEFORE
```
locations
US-TX-HOUSTON-2001 RANKIN ROAD
```
Displays as: "locations US-TX-HOUSTON-2001 RANKIN ROAD"

### AFTER
```
Houston, TX
```

---

## Example 3: International Location

### BEFORE
```
locations
BR-RJ-RIO DE JANEIRO-VENTURA-AV REPUBLICA DO CHILE 330
```
Displays as: "locations BR-RJ-RIO DE JANEIRO-VENTURA-AV REPUBLICA DO CHILE 330"

### AFTER
```
Rio De Janeiro, Rio de Janeiro, Brazil
```

---

## Example 4: Supply Chain Job with Mixed Formatting

### BEFORE
```
Do you enjoy working on Supply Chain projects?

Would you like the opportunity to work for oilfield services company?

Join our team

Our Oilfield Services business provides intelligent, connected technologies to monitor and control our energy extraction assets. Our team arranging technical expertise to meet our client expectation. We provide customers with the peace of mind needed to reliably and efficiently improve their operations.

Partner with the best

As the Supply Chain Localization Leader you will be responsible for leading and executing an integrated Supply Chain Localization strategy under UAE Unified ICV Program v4.0, targeting Goods Manufactured and Third-Party Spend to shift sourcing from import-heavy to locally optimized.

As a Supply Chain Localization Leader, you will be responsible for:
Developing and executing Supply Chain Localization Strategy for Baker Hughes business in the UAE. Targeting shift to UAE Based ICV-Certified Suppliers. Specific categories focus is needed on are Goods Manufactured as well as Third Party Spend.
Performing analysis of current supply chain Practices, conducting existing spend diagnostics, mapping high spend categories to UAE-Made alternatives.
Revamping Supply Chain for Local Sourcing, Partner with Local suppliers for active participation in Local Supplier Development programs.
```

### AFTER

Do you enjoy working on Supply Chain projects?

Would you like the opportunity to work for oilfield services company?

Join our team

Our Oilfield Services business provides intelligent, connected technologies to monitor and control our energy extraction assets. Our team arranging technical expertise to meet our client expectation. We provide customers with the peace of mind needed to reliably and efficiently improve their operations.

### Partner With The Best

As the Supply Chain Localization Leader you will be responsible for leading and executing an integrated Supply Chain Localization strategy under UAE Unified ICV Program v4.0, targeting Goods Manufactured and Third-Party Spend to shift sourcing from import-heavy to locally optimized.

As a Supply Chain Localization Leader, you will be responsible for: Developing and executing Supply Chain Localization Strategy for Baker Hughes business in the UAE. Targeting shift to UAE Based ICV-Certified Suppliers. Specific categories focus is needed on are Goods Manufactured as well as Third Party Spend. Performing analysis of current supply chain Practices, conducting existing spend diagnostics, mapping high spend categories to UAE-Made alternatives. Revamping Supply Chain for Local Sourcing, Partner with Local suppliers for active participation in Local Supplier Development programs.

---

## Visual Improvements

### Typography & Spacing
- **Headers**: Bold, larger font, clear visual hierarchy
- **Lists**: Proper bullet points with consistent indentation
- **Paragraphs**: Comfortable line height and spacing
- **Sections**: Clear separation with appropriate margins

### Mobile Experience
- Text wraps properly on small screens
- Lists remain readable without horizontal scroll
- Headers stand out without being overwhelming
- Touch-friendly spacing between elements

### Accessibility
- Semantic HTML (h3, ul, li, p)
- Screen reader friendly structure
- Proper heading hierarchy
- Meaningful list markup

### Professional Appearance
- Consistent formatting across all jobs
- Clean, organized presentation
- Easy to scan and read
- Highlights important sections

---

## Technical Details

### Block Types Generated

1. **Header Block**
```javascript
{
  type: 'header',
  content: 'Essential Responsibilities'
}
```
Rendered as: `<h3>Essential Responsibilities</h3>`

2. **List Block**
```javascript
{
  type: 'list',
  items: [
    'First item',
    'Second item',
    'Third item'
  ]
}
```
Rendered as:
```html
<ul>
  <li>First item</li>
  <li>Second item</li>
  <li>Third item</li>
</ul>
```

3. **Paragraph Block**
```javascript
{
  type: 'paragraph',
  content: 'This is a paragraph of text.'
}
```
Rendered as: `<p>This is a paragraph of text.</p>`

---

## Comparison Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Readability** | Poor - wall of text | Excellent - clear structure |
| **Headers** | Plain text with colons | Bold, styled headers |
| **Lists** | Raw bullet characters | Proper HTML lists |
| **Spacing** | Excessive/inconsistent | Clean and consistent |
| **Mobile** | Hard to read | Optimized for mobile |
| **Locations** | Raw codes with "locations\n" | Human-readable format |
| **Accessibility** | Generic div | Semantic HTML |
| **Professional** | Unprofessional | Clean and polished |

---

## User Experience Impact

### Job Seekers
- ✅ Can quickly scan requirements
- ✅ Clear understanding of role structure
- ✅ Easy to identify key qualifications
- ✅ Professional presentation builds trust
- ✅ Mobile-friendly for on-the-go browsing

### Recruiters/HR
- ✅ Consistent formatting across all postings
- ✅ Professional brand presentation
- ✅ Easy to compare multiple positions
- ✅ Clear communication of expectations

### Technical SEO
- ✅ Semantic HTML improves search indexing
- ✅ Better content structure for crawlers
- ✅ Improved accessibility score
- ✅ Clean markup for rich snippets
