/**
 * Date/time utilities (e.g. ET timezone for market slugs).
 */
export function getETDateTime() {
  const etDate = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );

  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];

  const month = months[etDate.getMonth()];
  const day = etDate.getDate();
  let hour = etDate.getHours();
  const ampm = hour >= 12 ? "pm" : "am";

  hour = hour % 12;
  if (hour === 0) hour = 12;

  return { month, day, hour, ampm, rawHour: etDate.getHours() };
}
