const ROADMAP = [
  { id: 'operator-typeahead', title: 'Operator & contractor typeahead filter', desc: 'Type ahead any operator (Equinor, Aramco, Ørsted) or EPC name to instantly filter the feed.' },
  { id: 'saved-presets', title: 'Saved & "my patch" filter presets', desc: 'Save a filter combination as a named preset. Personalize for each recruiter\'s desk.' },
  { id: 'vessel-tracking', title: 'Vessel-tracking signals', desc: 'Heavy-lift, cable-lay, and DSV/CSV vessel mobilizations from Marine Traffic. Catches crewing windows 30-45 days before press releases.' },
  { id: 'paid-sources', title: 'Paid trade sources', desc: 'Upstream Online, MEED, Mining Journal once we evaluate a shared agency seat.' },
  { id: 'per-contact-outreach', title: 'Per-contact personalized outreach', desc: 'Tailored InMail and email drafts for each TA contact based on their tenure, region, and projects shipped.' },
  { id: 'company-prebake', title: 'Pre-baked company cards', desc: 'After a PDL plan upgrade, top-N most-clicked companies refresh quarterly so card opens are instant for high-traffic targets.' },
]

export default function ComingSoonSection() {
  return (
    <section className="bg-gray-50 border-t border-gray-200 mt-12 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-4">Coming soon</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROADMAP.map(item => (
            <article key={item.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{item.title}</h3>
              <p className="text-xs text-gray-600 leading-relaxed">{item.desc}</p>
            </article>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-6 text-center">
          Have feedback or a feature you wish was here? Email <a href="mailto:jesse@moblyze.me" className="text-blue-700 hover:underline">jesse@moblyze.me</a>.
        </p>
      </div>
    </section>
  )
}
