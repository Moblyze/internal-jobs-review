// react-select styles on the shared internal system (src/styles/mz-ui.css tokens, as literals because
// react-select takes JS style objects). Used by the Companies and Feed filter bars.
export const mzSelectStyles = {
  indicatorSeparator: () => ({ display: 'none' }),
  control: (base) => ({
    ...base,
    minHeight: '42px',
    borderRadius: '8px',
    borderColor: '#e2e7e6',
    '&:hover': { borderColor: '#8b9795' },
    boxShadow: 'none',
    '&:focus-within': {
      borderColor: '#14b3a8',
      boxShadow: '0 0 0 3px #eaf7f5'
    },
    fontSize: '14px',
    fontWeight: 600,
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0 6px',
  }),
  multiValue: (base) => ({
    ...base,
    backgroundColor: '#eaf7f5',
    borderRadius: '3px',
    margin: '1px 2px',
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: '#0a7c74',
    fontSize: '12px',
    padding: '1px 4px',
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: '#0a7c74',
    padding: '0 2px',
    '&:hover': {
      backgroundColor: '#c9ece8',
      color: '#10201f'
    }
  }),
  placeholder: (base) => ({
    ...base,
    color: '#8b9795',
    fontSize: '14px',
    fontWeight: 500
  }),
  input: (base) => ({
    ...base,
    fontSize: '0.8125rem',
    margin: '0',
    padding: '0',
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.8125rem',
    padding: '6px 10px',
    backgroundColor: state.isSelected
      ? '#0a7c74'
      : state.isFocused
      ? '#eaf7f5'
      : 'white',
    color: state.isSelected ? 'white' : '#10201f',
  }),
  indicatorsContainer: (base) => ({
    ...base,
    '& > div': { padding: '4px' },
  }),
  dropdownIndicator: (base) => ({
    ...base,
    padding: '4px',
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: '4px',
  }),
  groupHeading: (base) => ({
    ...base,
    fontSize: '0.7rem',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    paddingTop: '6px',
    paddingBottom: '2px'
  }),
  menu: (base) => ({
    ...base,
    zIndex: 20,
  }),
}
