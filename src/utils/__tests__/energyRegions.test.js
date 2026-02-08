/**
 * Energy Regions Tests
 */

import { describe, it, expect } from 'vitest'
import {
  TOP_ENERGY_REGIONS,
  ADDITIONAL_ENERGY_REGIONS,
  ALL_ENERGY_REGIONS,
  getRegionLocations,
  extractAllLocations
} from '../energyRegions'

describe('energyRegions', () => {
  describe('TOP_ENERGY_REGIONS', () => {
    it('should have exactly 5 top regions', () => {
      expect(TOP_ENERGY_REGIONS).toHaveLength(5)
    })

    it('should include Permian Basin as first region', () => {
      expect(TOP_ENERGY_REGIONS[0].name).toBe('Permian Basin')
      expect(TOP_ENERGY_REGIONS[0].id).toBe('permian-basin')
    })

    it('should include Gulf of Mexico', () => {
      const gulfRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'gulf-of-mexico')
      expect(gulfRegion).toBeDefined()
      expect(gulfRegion.offshore).toBe(true)
    })

    it('should include Middle East', () => {
      const middleEastRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'middle-east')
      expect(middleEastRegion).toBeDefined()
      expect(middleEastRegion.countries).toContain('AE')
    })

    it('should include North Sea', () => {
      const northSeaRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'north-sea')
      expect(northSeaRegion).toBeDefined()
      expect(northSeaRegion.offshore).toBe(true)
    })

    it('should include Asia Pacific', () => {
      const asiaPacificRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'asia-pacific')
      expect(asiaPacificRegion).toBeDefined()
      expect(asiaPacificRegion.countries).toContain('SG')
    })
  })

  describe('ADDITIONAL_ENERGY_REGIONS', () => {
    it('should have 5 additional regions', () => {
      expect(ADDITIONAL_ENERGY_REGIONS).toHaveLength(5)
    })

    it('should include Bakken', () => {
      const bakkenRegion = ADDITIONAL_ENERGY_REGIONS.find(r => r.id === 'bakken')
      expect(bakkenRegion).toBeDefined()
      expect(bakkenRegion.states).toContain('ND')
    })
  })

  describe('ALL_ENERGY_REGIONS', () => {
    it('should combine top and additional regions (10 total)', () => {
      expect(ALL_ENERGY_REGIONS).toHaveLength(10)
    })
  })

  describe('extractAllLocations', () => {
    it('should extract locations from jobs data', () => {
      const jobs = [
        { location: 'locations\nHouston, TX' },
        { location: 'locations\nMidland, TX\nOdessa, TX' },
        { location: 'locations\nSingapore' }
      ]

      const locations = extractAllLocations(jobs)

      expect(locations).toContain('Houston, TX')
      expect(locations).toContain('Midland, TX')
      expect(locations).toContain('Odessa, TX')
      expect(locations).toContain('Singapore')
      expect(locations).not.toContain('locations')
    })

    it('should handle empty jobs array', () => {
      const locations = extractAllLocations([])
      expect(locations).toHaveLength(0)
    })

    it('should deduplicate locations', () => {
      const jobs = [
        { location: 'locations\nHouston, TX' },
        { location: 'locations\nHouston, TX' }
      ]

      const locations = extractAllLocations(jobs)
      expect(locations).toHaveLength(1)
    })
  })

  describe('getRegionLocations', () => {
    const allLocations = [
      'Houston, TX',
      'Midland, TX',
      'Odessa, TX',
      'Carlsbad, NM',
      'Singapore',
      'Dubai, United Arab Emirates',
      'Aberdeen, United Kingdom',
      'Calgary, AB, Canada'
    ]

    it('should match Permian Basin locations', () => {
      const permianRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'permian-basin')
      const matches = getRegionLocations(permianRegion, allLocations)

      expect(matches).toContain('Midland, TX')
      expect(matches).toContain('Odessa, TX')
      expect(matches).toContain('Carlsbad, NM')
      expect(matches).not.toContain('Houston, TX') // Gulf region, not Permian
    })

    it('should match Gulf of Mexico locations', () => {
      const gulfRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'gulf-of-mexico')
      const matches = getRegionLocations(gulfRegion, allLocations)

      expect(matches).toContain('Houston, TX')
    })

    it('should match Middle East locations', () => {
      const middleEastRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'middle-east')
      const matches = getRegionLocations(middleEastRegion, allLocations)

      expect(matches).toContain('Dubai, United Arab Emirates')
    })

    it('should match North Sea locations', () => {
      const northSeaRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'north-sea')
      const matches = getRegionLocations(northSeaRegion, allLocations)

      expect(matches).toContain('Aberdeen, United Kingdom')
    })

    it('should match Asia Pacific locations', () => {
      const asiaPacificRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'asia-pacific')
      const matches = getRegionLocations(asiaPacificRegion, allLocations)

      expect(matches).toContain('Singapore')
    })

    it('should handle locations with raw format like "US-TX-Houston"', () => {
      const locationsWithRaw = [
        'US-TX-Houston',
        'US-TX-Midland',
        'US-NM-Carlsbad'
      ]

      const permianRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'permian-basin')
      const matches = getRegionLocations(permianRegion, locationsWithRaw)

      expect(matches.length).toBeGreaterThan(0)
    })
  })
})
