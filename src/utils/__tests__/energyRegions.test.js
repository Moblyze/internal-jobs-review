/**
 * Energy Regions Tests
 */

import { describe, it, expect } from 'vitest'
import {
  TOP_ENERGY_REGIONS,
  ADDITIONAL_ENERGY_REGIONS,
  ALL_ENERGY_REGIONS,
  getRegionLocations,
  getRegionLocationValues,
  extractAllLocations
} from '../energyRegions'

describe('energyRegions', () => {
  describe('TOP_ENERGY_REGIONS', () => {
    it('should have exactly 5 top regions', () => {
      expect(TOP_ENERGY_REGIONS).toHaveLength(5)
    })

    it('should include Gulf of Mexico as first region', () => {
      expect(TOP_ENERGY_REGIONS[0].name).toBe('Gulf of Mexico')
      expect(TOP_ENERGY_REGIONS[0].id).toBe('gulf-of-mexico')
    })

    it('should include Permian Basin', () => {
      const region = TOP_ENERGY_REGIONS.find(r => r.id === 'permian-basin')
      expect(region).toBeDefined()
    })

    it('should include North Sea', () => {
      const northSeaRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'north-sea')
      expect(northSeaRegion).toBeDefined()
      expect(northSeaRegion.offshore).toBe(true)
    })

    it('should include Alaska with states field', () => {
      const alaskaRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'alaska')
      expect(alaskaRegion).toBeDefined()
      expect(alaskaRegion.states).toContain('AK')
    })
  })

  describe('ADDITIONAL_ENERGY_REGIONS', () => {
    it('should have 8 additional regions', () => {
      expect(ADDITIONAL_ENERGY_REGIONS).toHaveLength(8)
    })

    it('should include Middle East', () => {
      const middleEastRegion = ADDITIONAL_ENERGY_REGIONS.find(r => r.id === 'middle-east')
      expect(middleEastRegion).toBeDefined()
      expect(middleEastRegion.countries).toContain('AE')
    })

    it('should include Asia Pacific', () => {
      const asiaPacificRegion = ADDITIONAL_ENERGY_REGIONS.find(r => r.id === 'asia-pacific')
      expect(asiaPacificRegion).toBeDefined()
      expect(asiaPacificRegion.countries).toContain('SG')
    })

    it('should include Bakken', () => {
      const bakkenRegion = ADDITIONAL_ENERGY_REGIONS.find(r => r.id === 'bakken')
      expect(bakkenRegion).toBeDefined()
      expect(bakkenRegion.keywords).toContain('bakken')
    })
  })

  describe('ALL_ENERGY_REGIONS', () => {
    it('should combine top and additional regions (13 total)', () => {
      expect(ALL_ENERGY_REGIONS).toHaveLength(13)
    })
  })

  describe('extractAllLocations', () => {
    it('should extract and format locations from jobs data', () => {
      const jobs = [
        { location: 'locations\nHouston, TX' },
        { location: 'locations\nMidland, TX\nOdessa, TX' },
        { location: 'locations\nSingapore' }
      ]

      const locations = extractAllLocations(jobs)

      // Note: Actual formatting depends on locationParser.getAllLocations
      // These tests verify the function returns formatted strings
      expect(locations).toBeDefined()
      expect(Array.isArray(locations)).toBe(true)
      expect(locations).not.toContain('locations')
    })

    it('should handle empty jobs array', () => {
      const locations = extractAllLocations([])
      expect(locations).toHaveLength(0)
    })

    it('should deduplicate formatted locations', () => {
      const jobs = [
        { location: 'locations\nHouston, TX' },
        { location: 'locations\nHouston, TX' }
      ]

      const locations = extractAllLocations(jobs)
      // Should deduplicate identical formatted locations
      const uniqueCount = new Set(locations).size
      expect(locations.length).toBe(uniqueCount)
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
      const middleEastRegion = ADDITIONAL_ENERGY_REGIONS.find(r => r.id === 'middle-east')
      const matches = getRegionLocations(middleEastRegion, allLocations)

      expect(matches).toContain('Dubai, United Arab Emirates')
    })

    it('should match North Sea locations', () => {
      const northSeaRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'north-sea')
      const matches = getRegionLocations(northSeaRegion, allLocations)

      expect(matches).toContain('Aberdeen, United Kingdom')
    })

    it('should match Asia Pacific locations', () => {
      const asiaPacificRegion = ADDITIONAL_ENERGY_REGIONS.find(r => r.id === 'asia-pacific')
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

  describe('getRegionLocationValues', () => {
    // Mock locationOptions in the format produced by createGroupedLocationOptionsWithGeodata
    const mockLocationOptions = [
      {
        label: 'United States - Alaska',
        options: [
          {
            label: 'Anchorage',
            value: 'Anchorage, AK',
            metadata: { countryCode: 'US', stateCode: 'AK', city: 'Anchorage', country: 'United States' }
          },
          {
            label: 'Prudhoe Bay',
            value: 'Prudhoe Bay, AK',
            metadata: { countryCode: 'US', stateCode: 'AK', city: 'Prudhoe Bay', country: 'United States' }
          },
          {
            label: 'Juneau',
            value: 'Juneau, AK',
            metadata: { countryCode: 'US', stateCode: 'AK', city: 'Juneau', country: 'United States' }
          }
        ]
      },
      {
        label: 'United States - Texas',
        options: [
          {
            label: 'Houston',
            value: 'Houston, TX',
            metadata: { countryCode: 'US', stateCode: 'TX', city: 'Houston', country: 'United States' }
          },
          {
            label: 'Midland',
            value: 'Midland, TX',
            metadata: { countryCode: 'US', stateCode: 'TX', city: 'Midland', country: 'United States' }
          },
          {
            label: 'Odessa',
            value: 'Odessa, TX',
            metadata: { countryCode: 'US', stateCode: 'TX', city: 'Odessa', country: 'United States' }
          }
        ]
      },
      {
        label: 'United Arab Emirates',
        options: [
          {
            label: 'Dubai',
            value: 'Dubai, United Arab Emirates',
            metadata: { countryCode: 'AE', city: 'Dubai', country: 'United Arab Emirates' }
          }
        ]
      },
      {
        label: 'United Kingdom',
        options: [
          {
            label: 'Aberdeen',
            value: 'Aberdeen, United Kingdom',
            metadata: { countryCode: 'GB', city: 'Aberdeen', country: 'United Kingdom' }
          }
        ]
      }
    ]

    it('should match Alaska region using state metadata', () => {
      const alaskaRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'alaska')
      const matches = getRegionLocationValues(alaskaRegion, mockLocationOptions)

      expect(matches).toContain('Anchorage, AK')
      expect(matches).toContain('Prudhoe Bay, AK')
      expect(matches).toContain('Juneau, AK')
      expect(matches).not.toContain('Houston, TX')
    })

    it('should not produce duplicates', () => {
      const alaskaRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'alaska')
      const matches = getRegionLocationValues(alaskaRegion, mockLocationOptions)

      const uniqueMatches = [...new Set(matches)]
      expect(matches.length).toBe(uniqueMatches.length)
    })

    it('should match Permian Basin locations', () => {
      const permianRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'permian-basin')
      const matches = getRegionLocationValues(permianRegion, mockLocationOptions)

      expect(matches).toContain('Midland, TX')
      expect(matches).toContain('Odessa, TX')
      expect(matches).not.toContain('Anchorage, AK')
    })

    it('should match Middle East by country code', () => {
      const middleEastRegion = ADDITIONAL_ENERGY_REGIONS.find(r => r.id === 'middle-east')
      const matches = getRegionLocationValues(middleEastRegion, mockLocationOptions)

      expect(matches).toContain('Dubai, United Arab Emirates')
      expect(matches).not.toContain('Houston, TX')
    })

    it('should match North Sea by country code', () => {
      const northSeaRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'north-sea')
      const matches = getRegionLocationValues(northSeaRegion, mockLocationOptions)

      expect(matches).toContain('Aberdeen, United Kingdom')
    })

    it('should handle empty locationOptions', () => {
      const alaskaRegion = TOP_ENERGY_REGIONS.find(r => r.id === 'alaska')
      const matches = getRegionLocationValues(alaskaRegion, [])

      expect(matches).toHaveLength(0)
    })
  })
})
