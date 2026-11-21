import 'dotenv/config';
import bcrypt from 'bcryptjs';
import readline from 'readline';
import { prisma } from '../prisma';
import { hashPin, pinLookupPrefix } from '../lib/pin';

/**
 * Staff account maintenance from the command line, until the back office has
 * a screen for it.
 *
 *   npm run users -- list
 *   npm run users -- set-pin <email>        (PIN read from stdin)
 *   npm run users -- set-password <email>   (password read from stdin)
 *   npm run users -- revoke <email>         (sign out of every device)
 *   npm run users -- disable <email>        (block sign-in, sign out everywhere)
 *   npm run users -- enable <email>
 *
 * Secrets are read from stdin rather than argv so they stay out of shell
 * history and the process list. Point DATABASE_URL (and PIN_PEPPER, for PINs)
 * at the target environment; PIN_PEPPER must match the server's or the new PIN
 * will not verify.
 *
 * Changing a PIN or password also signs the user out everywhere. The API caches
 * a user's state for up to 30s, so a revoke takes effect within that window.
 */

const USAGE = `Usage:
  npm run users -- list
  npm run users -- set-pin <email>
  npm run users -- set-password <email>
  npm run users -- revoke <email>
  npm run users -- disable <email>
  npm run users -- enable <email>`;

async function readSecret(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  if (process.stdin.isTTY) process.stderr.write(prompt);
  const line = await new Promise<string>((resolve) => rl.once('line', resolve).once('close', () => resolve('')));
  rl.close();
  return line.trim();
}

async function findUser(email: string | undefined) {
  if (!email) throw new Error(`An email is required.\n\n${USAGE}`);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw new Error(`No user with email ${email}`);
  return user;
}

async function main(): Promise<void> {
  const [command, email] = process.argv.slice(2);

  switch (command) {
    case 'list': {
      const users = await prisma.user.findMany({ orderBy: { email: 'asc' } });
      for (const u of users) {
        const status = u.disabledAt ? 'DISABLED' : 'active';
        console.log(`${u.email.padEnd(32)} ${u.role.padEnd(8)} ${status.padEnd(8)} pin:${u.pin ? 'set' : 'none'}  ${u.name}`);
      }
      return;
    }

    case 'set-pin': {
      const user = await findUser(email);
      const pin = await readSecret('New 4-digit PIN: ');
      if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits');
      const clash = await prisma.user.findFirst({
        where: { pin: { startsWith: pinLookupPrefix(pin) }, id: { not: user.id } },
        select: { email: true },
      });
      if (clash) throw new Error('That PIN is already used by another account. Choose another.');
      await prisma.user.update({
        where: { id: user.id },
        data: { pin: await hashPin(pin), tokenVersion: { increment: 1 } },
      });
      console.log(`PIN changed for ${user.email}; existing sessions signed out.`);
      return;
    }

    case 'set-password': {
      const user = await findUser(email);
      const password = await readSecret('New password (min 12 characters): ');
      if (password.length < 12) throw new Error('Password must be at least 12 characters');
      await prisma.user.update({
        where: { id: user.id },
        data: { password: await bcrypt.hash(password, 10), tokenVersion: { increment: 1 } },
      });
      console.log(`Password changed for ${user.email}; existing sessions signed out.`);
      return;
    }

    case 'revoke': {
      const user = await findUser(email);
      await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
      console.log(`Signed ${user.email} out of every device.`);
      return;
    }

    case 'disable': {
      const user = await findUser(email);
      await prisma.user.update({
        where: { id: user.id },
        data: { disabledAt: new Date(), tokenVersion: { increment: 1 } },
      });
      console.log(`Disabled ${user.email}: cannot sign in, existing sessions signed out.`);
      return;
    }

    case 'enable': {
      const user = await findUser(email);
      await prisma.user.update({ where: { id: user.id }, data: { disabledAt: null } });
      console.log(`Enabled ${user.email}.`);
      return;
    }

    default:
      throw new Error(USAGE);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
