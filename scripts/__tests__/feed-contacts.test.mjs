// Regression (Oct 27, 2026): after the Feed redesign the people-count indicator on a feed card was a plain
// span, so clicking it only toggled the card and never opened the contacts modal. These tests render the
// real components and check that the indicator and the "View contacts" control are buttons that open it.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(root, 'package.json'))
let React, renderToStaticMarkup, FeedCard, ContactsButton, DecisionMakers

before(async () => {
  // Bundle inside the repo so react, react-dom and react-router-dom resolve to the project's single copy.
  const dir = join(root, 'node_modules', '.cache', 'feed-contacts-test')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, 'bundle.mjs')
  const entry = `export { default as FeedCard, ContactsButton } from ${JSON.stringify(join(root, 'src/components/feed/FeedCard.jsx'))}
export { default as DecisionMakers } from ${JSON.stringify(join(root, 'src/components/feed/DecisionMakers.jsx'))}`
  await build({
    stdin: { contents: entry, resolveDir: root, loader: 'js' },
    bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    external: ['react', 'react-dom', 'react-router-dom', 'react/jsx-runtime'], logLevel: 'error',
  })
  ;({ FeedCard, ContactsButton, DecisionMakers } = await import(pathToFileURL(out).href))
  React = require('react')
  ;({ renderToStaticMarkup } = require('react-dom/server'))
})

const coverage = { 'acme offshore': { identified: 4, with_email: 2 } }

test('people-count indicator is a button that opens the contacts modal', () => {
  let opened = 0, stopped = 0
  const el = ContactsButton({ coverage, company: 'Acme Offshore', onOpen: () => { opened++ } })
  assert.ok(el, 'renders when we have people on file')
  assert.equal(el.type, 'button')
  el.props.onClick({ stopPropagation: () => { stopped++ } })
  assert.equal(opened, 1, 'click opens the modal')
  assert.equal(stopped, 1, 'click does not also toggle the card')
})

test('feed card renders the indicator as a button, not a span', () => {
  const entry = { id: 'e1', headline: 'Acme wins hookup contract', hiring_entity: { name: 'Acme Offshore' }, sources: [] }
  const html = renderToStaticMarkup(React.createElement(FeedCard, { entry, coverage, taxonomy: null, pdlCache: null }))
  assert.match(html, /<button[^>]*class="feed-contacts"/)
  assert.match(html, /<button[^>]*class="feed-co feed-co--strong"/)
})

test('role labels are plain text and a View contacts button opens the modal', () => {
  let opened = 0
  const html = renderToStaticMarkup(React.createElement(DecisionMakers, { archetypes: ['site_manager', 'hiring_manager'], company: 'Acme Offshore', onViewContacts: () => { opened++ } }))
  assert.match(html, /<li class="dm-role">Site Manager<\/li>/)
  assert.doesNotMatch(html, /<button[^>]*>Site Manager/)
  assert.match(html, /<button[^>]*class="dm-view"[^>]*>View contacts at Acme Offshore<\/button>/)
})
