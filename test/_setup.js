// Deterministic environment for the test suite. Imported first so config.js picks it up.
process.env.DESS_BATTERY_VOLTAGE = '24';
process.env.TZ = 'Asia/Karachi'; // the fixture time comments are in PKT (UTC+5)
process.env.DAILY_REPORT_HOUR = '21';
process.env.NOTIFY_DRIVER = 'whatsapp';
process.env.UTILITY_NAME = 'WAPDA';
process.env.PV_ARRAY_W = '4520'; // enables the pv_underperforming rule for its tests
