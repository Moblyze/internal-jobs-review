// scripts/trend-report/dashboard.js
/**
 * Build the 2D values array for the BD Dashboard tab.
 *
 * Trend Data columns (0-indexed):
 *   A week_start | B dimension | C value | D active | E new | F removed | G net | H momentum3w
 *
 * Formulas reference 'Trend Data' by name. `USER_ENTERED` mode (set in sheets.js)
 * parses them.
 */

export function buildDashboardValues({ insightLines, currentWeekStart, now }) {
  const weekLabel = currentWeekStart.toISOString().slice(0, 10);
  const updated = (now || new Date()).toISOString();
  const blank = [''];

  const insightsBlock = [];
  for (let i = 0; i < 5; i++) {
    insightsBlock.push([insightLines[i] || '']);
  }

  const pad = (row, width) => row.concat(Array(Math.max(0, width - row.length)).fill(''));

  const values = [];
  values.push(pad(['Moblyze BD — Job Scraping Trend Dashboard'], 6));
  values.push(pad([`Last updated: ${updated}`], 6));
  values.push(pad([`Current week: ${weekLabel}`, '', weekLabel], 6));
  values.push(blank);
  values.push(pad(['Key insights'], 6));
  for (const row of insightsBlock) values.push(pad(row, 6));
  values.push(blank);

  values.push(pad(['This week at a glance'], 6));
  values.push(pad(['Metric', 'Value'], 6));
  values.push(pad([
    'Total active jobs',
    `=SUMIFS('Trend Data'!D:D,'Trend Data'!A:A,$C$3,'Trend Data'!B:B,"employer")`,
  ], 6));
  values.push(pad([
    'New postings this week',
    `=SUMIFS('Trend Data'!E:E,'Trend Data'!A:A,$C$3,'Trend Data'!B:B,"employer")`,
  ], 6));
  values.push(pad([
    'Removed this week',
    `=SUMIFS('Trend Data'!F:F,'Trend Data'!A:A,$C$3,'Trend Data'!B:B,"employer")`,
  ], 6));
  values.push(pad([
    'Net change',
    `=SUMIFS('Trend Data'!G:G,'Trend Data'!A:A,$C$3,'Trend Data'!B:B,"employer")`,
  ], 6));
  values.push(blank);

  values.push(pad(['Top 10 employers by net change'], 6));
  values.push(pad(['Employer', 'Active', 'New', 'Removed', 'Net', '3wk momentum'], 6));
  values.push([
    `=QUERY('Trend Data'!A:H, "select C, D, E, F, G, H where A = date '${weekLabel}' and B = 'employer' and D >= 10 order by G desc limit 10", 0)`,
  ]);
  for (let i = 0; i < 9; i++) values.push(blank);
  values.push(blank);

  values.push(pad(['Subsector momentum (current week)'], 6));
  values.push(pad(['Subsector', 'Active', 'New', 'Removed', 'Net', '3wk momentum'], 6));
  values.push([
    `=QUERY('Trend Data'!A:H, "select C, D, E, F, G, H where A = date '${weekLabel}' and B = 'subsector' order by H desc", 0)`,
  ]);
  for (let i = 0; i < 10; i++) values.push(blank);
  values.push(blank);

  values.push(pad(['Region momentum (current week)'], 6));
  values.push(pad(['Region', 'Active', 'New', 'Removed', 'Net', '3wk momentum'], 6));
  values.push([
    `=QUERY('Trend Data'!A:H, "select C, D, E, F, G, H where A = date '${weekLabel}' and B = 'region' order by H desc limit 10", 0)`,
  ]);
  for (let i = 0; i < 9; i++) values.push(blank);

  return values;
}
