const DEFAULT_PASSCODE = 'heavenzy1997@gmail.com';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { passcode } = req.body ?? {};
  const expected = process.env.APP_PASSCODE || DEFAULT_PASSCODE;

  if (typeof passcode === 'string' && passcode === expected) {
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ ok: false, error: 'Incorrect passcode' });
}
