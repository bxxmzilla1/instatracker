const DEFAULT_PASSCODE = 'heavenzy1997@gmail.com';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { passcode, password } = req.body ?? {};
  const provided = typeof password === 'string' ? password : passcode;
  const expected = process.env.APP_PASSCODE || DEFAULT_PASSCODE;

  if (typeof provided === 'string' && provided === expected) {
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ ok: false, error: 'Incorrect credentials' });
}
