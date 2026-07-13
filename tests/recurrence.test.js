const assert = require("assert");
const {
  MAX_OCCURRENCES,
  generateOccurrenceDates,
  buildRecurrenceDateList,
  buildRecurrenceSummary,
  validateRecurrenceRule,
  formatRecurrenceStartDate,
  parseRecurrenceStartDate,
} = require("../lib/jobs/recurrence");

function ymd(date) {
  return formatRecurrenceStartDate(date);
}

// Daily: every 1 day for 3 occurrences
{
  const rule = {
    isRepeat: true,
    frequency: "daily",
    interval: 1,
    startDate: "2026-01-01",
    weekDays: [],
    monthlyMode: "dayOfMonth",
    monthDay: 1,
    monthOrdinal: 1,
    monthWeekday: 0,
  };
  const dates = generateOccurrenceDates(rule, { maxOccurrences: 3 });
  assert.strictEqual(dates.length, 3);
  assert.deepStrictEqual(dates.map(ymd), ["2026-01-01", "2026-01-02", "2026-01-03"]);
}

// Weekly multi-day: Tue + Thu
{
  const rule = {
    isRepeat: true,
    frequency: "weekly",
    interval: 1,
    startDate: "2026-01-06", // Tuesday
    weekDays: [2, 4],
    monthlyMode: "dayOfMonth",
    monthDay: 6,
    monthOrdinal: 1,
    monthWeekday: 2,
  };
  const dates = generateOccurrenceDates(rule, { maxOccurrences: 4 });
  assert.strictEqual(dates.length, 4);
  assert.deepStrictEqual(dates.map(ymd), [
    "2026-01-06",
    "2026-01-08",
    "2026-01-13",
    "2026-01-15",
  ]);
}

// Monthly day-of-month
{
  const rule = {
    isRepeat: true,
    frequency: "monthly",
    interval: 1,
    startDate: "2026-01-15",
    weekDays: [],
    monthlyMode: "dayOfMonth",
    monthDay: 15,
    monthOrdinal: 1,
    monthWeekday: 0,
  };
  const dates = generateOccurrenceDates(rule, { maxOccurrences: 3 });
  assert.strictEqual(dates.length, 3);
  assert.deepStrictEqual(dates.map(ymd), ["2026-01-15", "2026-02-15", "2026-03-15"]);
}

// Monthly first Sunday
{
  const rule = {
    isRepeat: true,
    frequency: "monthly",
    interval: 1,
    startDate: "2026-01-04", // first Sunday of Jan 2026
    weekDays: [],
    monthlyMode: "dayOfWeek",
    monthDay: 4,
    monthOrdinal: 1,
    monthWeekday: 0,
  };
  const dates = generateOccurrenceDates(rule, { maxOccurrences: 3 });
  assert.strictEqual(dates.length, 3);
  assert.deepStrictEqual(dates.map(ymd), ["2026-01-04", "2026-02-01", "2026-03-01"]);
}

// Yearly
{
  const rule = {
    isRepeat: true,
    frequency: "yearly",
    interval: 1,
    startDate: "2026-06-15",
    weekDays: [],
    monthlyMode: "dayOfMonth",
    monthDay: 15,
    monthOrdinal: 1,
    monthWeekday: 0,
  };
  const dates = generateOccurrenceDates(rule, { maxOccurrences: 3 });
  assert.strictEqual(dates.length, 3);
  assert.deepStrictEqual(dates.map(ymd), ["2026-06-15", "2027-06-15", "2028-06-15"]);
}

// 52-cap
{
  const rule = {
    isRepeat: true,
    frequency: "daily",
    interval: 1,
    startDate: "2026-01-01",
    weekDays: [],
    monthlyMode: "dayOfMonth",
    monthDay: 1,
    monthOrdinal: 1,
    monthWeekday: 0,
  };
  const dates = generateOccurrenceDates(rule);
  assert.strictEqual(dates.length, MAX_OCCURRENCES);
  assert.strictEqual(ymd(dates[0]), "2026-01-01");
  assert.strictEqual(ymd(dates[MAX_OCCURRENCES - 1]), "2026-02-21");
}

// Summary includes cap note
{
  const summary = buildRecurrenceSummary({
    isRepeat: true,
    frequency: "monthly",
    interval: 1,
    startDate: "2026-07-01",
    weekDays: [],
    monthlyMode: "dayOfWeek",
    monthOrdinal: 1,
    monthWeekday: 0,
    monthDay: 1,
  });
  assert.match(summary, /first Sunday/i);
  assert.match(summary, /52 occurrences/i);
}

// endCount stops generation early (4 occurrences, monthly every 3 months)
{
  const rule = {
    isRepeat: true,
    frequency: "monthly",
    interval: 3,
    startDate: "2026-01-15",
    weekDays: [],
    monthlyMode: "dayOfMonth",
    monthDay: 15,
    monthOrdinal: 1,
    monthWeekday: 0,
    endCount: 4,
  };
  const dates = generateOccurrenceDates(rule);
  assert.strictEqual(dates.length, 4);
  assert.deepStrictEqual(dates.map(ymd), [
    "2026-01-15",
    "2026-04-15",
    "2026-07-15",
    "2026-10-15",
  ]);
}

// endCount above the hard cap clamps to MAX_OCCURRENCES
{
  const rule = {
    isRepeat: true,
    frequency: "daily",
    interval: 1,
    startDate: "2026-01-01",
    weekDays: [],
    monthlyMode: "dayOfMonth",
    monthDay: 1,
    monthOrdinal: 1,
    monthWeekday: 0,
    endCount: 100,
  };
  const dates = generateOccurrenceDates(rule);
  assert.strictEqual(dates.length, MAX_OCCURRENCES);
}

// buildRecurrenceDateList length equals the requested count
{
  const rule = {
    isRepeat: true,
    frequency: "weekly",
    interval: 1,
    startDate: "2026-01-06", // Tuesday
    weekDays: [2],
    monthlyMode: "dayOfMonth",
    monthDay: 6,
    monthOrdinal: 1,
    monthWeekday: 2,
    endCount: 6,
  };
  const list = buildRecurrenceDateList(rule);
  assert.strictEqual(list.length, 6);
  assert.strictEqual(list.length, generateOccurrenceDates(rule).length);
}

// Monthly every 3 months on first Sunday, 3 occurrences
{
  const rule = {
    isRepeat: true,
    frequency: "monthly",
    interval: 3,
    startDate: "2024-09-04",
    weekDays: [0],
    monthlyMode: "dayOfWeek",
    monthDay: 4,
    monthOrdinal: 1,
    monthWeekday: 0,
    endCount: 3,
  };
  const dates = generateOccurrenceDates(rule, { maxOccurrences: 3 });
  assert.strictEqual(dates.length, 3);
}

// Validation rejects invalid weekly rule
{
  const result = validateRecurrenceRule({
    isRepeat: true,
    frequency: "weekly",
    interval: 1,
    startDate: "2026-01-01",
    weekDays: [],
    monthlyMode: "dayOfMonth",
    monthDay: 1,
    monthOrdinal: 1,
    monthWeekday: 0,
  });
  assert.strictEqual(result.valid, false);
}

// Validation rejects empty start date
{
  const result = validateRecurrenceRule({
    isRepeat: true,
    frequency: "monthly",
    interval: 1,
    startDate: "",
    weekDays: [],
    monthlyMode: "dayOfMonth",
    monthDay: 15,
    monthOrdinal: 1,
    monthWeekday: 0,
    endCount: 3,
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => /start date/i.test(e)));
}

// Invalid rule yields zero occurrence dates (submit guard scenario)
{
  const invalidRule = {
    isRepeat: true,
    frequency: "weekly",
    interval: 1,
    startDate: "2026-01-01",
    weekDays: [],
    monthlyMode: "dayOfMonth",
    monthDay: 1,
    monthOrdinal: 1,
    monthWeekday: 0,
    endCount: 3,
  };
  assert.strictEqual(validateRecurrenceRule(invalidRule).valid, false);
  assert.strictEqual(generateOccurrenceDates(invalidRule).length, 0);
}

// Non-repeat single job date from startDate string
{
  const startDate = "2026-08-06";
  const jobDates = [new Date(`${startDate}T00:00:00`)];
  assert.strictEqual(jobDates.length, 1);
  assert.strictEqual(ymd(jobDates[0]), startDate);
}

assert.ok(parseRecurrenceStartDate("2026-01-01"));

console.log("recurrence tests passed");
