import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { networkInterfaces, hostname } from 'node:os';
import { requireThat } from './domain.mjs';

// Adresele IPv4 din rețeaua locală, în ordine stabilă. Elevii se conectează pe una dintre ele.
export function localAddresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces()))
    for (const net of list || [])
      if (net.family === 'IPv4' && !net.internal) found.push(net.address);
  return [...new Set(found)].sort();
}

export function certificateFingerprint(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return createHash('sha256').update(Buffer.from(body, 'base64')).digest('hex').match(/../g).join(':').toUpperCase();
}

// Certificatul acoperă numele calculatorului și toate adresele IPv4 curente. Dacă rețeaua
// s-a schimbat (DHCP a dat alt IP), certificatul este regenerat ca elevii să se poată conecta.
export function certificateCovers(pem, names) {
  const text = String(pem);
  return names.every(n => text.includes(n));
}

function generateWindows(dir, names) {
  const script = join(dir, 'issue.ps1');
  const pfx = join(dir, 'server.pfx');
  const password = randomBytes(24).toString('base64url');
  // New-SelfSignedCertificate emite în magazia utilizatorului; exportăm PFX și îl convertim în PEM.
  writeFileSync(script, [
    '$ErrorActionPreference = "Stop"',
    `$dns = @(${names.map(n => `'${n}'`).join(',')})`,
    '$cert = New-SelfSignedCertificate -Subject "CN=Labora" -DnsName $dns -CertStoreLocation "Cert:\\\\CurrentUser\\\\My" ' +
      '-KeyExportPolicy Exportable -KeyLength 2048 -KeyAlgorithm RSA -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(5) ' +
      '-TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1")',
    `$pw = ConvertTo-SecureString -String '${password}' -Force -AsPlainText`,
    `Export-PfxCertificate -Cert $cert -FilePath '${pfx}' -Password $pw | Out-Null`,
    'Remove-Item -Path ("Cert:\\\\CurrentUser\\\\My\\\\" + $cert.Thumbprint) -Force',
    'Write-Output $cert.Thumbprint',
  ].join('\n'), { encoding: 'utf8' });
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    requireThat(existsSync(pfx), 500, 'Certificatul nu a putut fi generat.');
    return { pfx: readFileSync(pfx), passphrase: password };
  } finally {
    rmSync(script, { force: true });
    rmSync(pfx, { force: true });
  }
}

// Returnează materialul TLS pentru serverul din laborator, generându-l la prima pornire
// și reînnoindu-l când adresele calculatorului profesorului s-au schimbat.
export function ensureCertificate(dir = join(process.env.ProgramData || '.', 'Labora', 'certs')) {
  const metaPath = join(dir, 'certificate.json');
  const names = [hostname(), 'localhost', ...localAddresses()];
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (certificateCovers(meta.names.join(','), names) && existsSync(join(dir, 'server.pfx.b64')))
      return { pfx: Buffer.from(readFileSync(join(dir, 'server.pfx.b64'), 'utf8'), 'base64'), passphrase: meta.passphrase, names: meta.names, fingerprint: meta.fingerprint, reused: true };
  }
  requireThat(process.platform === 'win32', 500, 'Generarea automată a certificatului este disponibilă doar pe Windows. Furnizați LABORA_TLS_CERT și LABORA_TLS_KEY.');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { pfx, passphrase } = generateWindows(dir, names);
  const fingerprint = createHash('sha256').update(pfx).digest('hex').match(/../g).join(':').toUpperCase();
  writeFileSync(join(dir, 'server.pfx.b64'), pfx.toString('base64'), { mode: 0o600 });
  writeFileSync(metaPath, JSON.stringify({ names, passphrase, fingerprint, issued: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return { pfx, passphrase, names, fingerprint, reused: false };
}
