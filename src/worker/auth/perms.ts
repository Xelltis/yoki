// Discordのサーバーでの権限。オーナーか、管理者（ADMINISTRATOR）・サーバー管理（MANAGE_GUILD）の権限があれば、
// そのサーバーにグループを作れ、そのグループでは常に管理者になる
const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

export function canManageGuild(g: { owner?: boolean; permissions?: string }): boolean {
  if (g.owner) return true;
  try {
    const p = BigInt(g.permissions ?? '0');
    return (p & ADMINISTRATOR) !== 0n || (p & MANAGE_GUILD) !== 0n;
  } catch {
    return false;
  }
}
