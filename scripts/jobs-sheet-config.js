/**
 * Where the "Job Scraping Results" spreadsheet lives (Nov 10, 2026).
 *
 * The original spreadsheet (1xb3Q...) hit Google's size wall on Nov 5, 2026 and
 * is kept frozen as a fallback. Live rows moved to a new spreadsheet; removed
 * rows go to the archive. Open by ID, never by name: a Drive name search
 * returns whichever file with that title comes first.
 * Mirrors scrapers/src/utils/sheet_config.py.
 */
export const JOBS_SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1MIaxJRCCoXI2ndethvbY_1XDjjcbIKJkuxkOaGv38IA';
export const ARCHIVE_SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_ARCHIVE_SPREADSHEET_ID || '1hG21eAhd4iYqieZvDMbLECL3yDFBFRLrygdxCdpe6VE';
// gid of the "Client Jobs - Aggregated" tab in the new spreadsheet.
export const CLIENT_JOBS_GID = 1054537560;
export const CLIENT_JOBS_URL =
  `https://docs.google.com/spreadsheets/d/${JOBS_SPREADSHEET_ID}/edit?gid=${CLIENT_JOBS_GID}#gid=${CLIENT_JOBS_GID}`;
