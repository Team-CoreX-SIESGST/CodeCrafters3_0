import { google } from 'googleapis';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const sa = require(path.resolve(__dirname, 'src/brave-cistern-447115-t5-c4a0113b34ff.json'));

console.log('email:', sa.client_email);
console.log('key starts:', sa.private_key.substring(0, 50));
console.log('has real newlines:', sa.private_key.includes('\n'));

const auth = new google.auth.GoogleAuth({
  credentials: sa,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

try {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: '1Ece40wMrW4uy2Yz1dvEjXalhU56oB3zK5IZtKdxj2uw',
    range: 'Sheet1',
  });
  console.log('SUCCESS rows:', r.data.values?.length);
  console.log('Headers:', JSON.stringify(r.data.values?.[0]));
} catch (e) {
  console.error('ERROR:', e.message);
  if (e.response?.data) {
    console.error('Google error detail:', JSON.stringify(e.response.data));
  }
}
