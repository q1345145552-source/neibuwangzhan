/**
 * 流程设置发布时每一步交上去的「客户看到的名字」（2026-10-20）。
 * 页面那一栏显示的是客户实际看到的（有统一子标题的是子标题）：这一步名字和客户名字都没动，就原样交回这一版存着的名字，
 * 不把子标题写进流程——否则什么都不改也能发布出新版本，以后子标题文案改了，按这些版本建的单也跟不上。
 */
export function publicNameToSubmit(
  orig: { name: string; publicName: string; savedPublicName: string } | undefined,
  row: { name: string; publicName: string },
): string {
  const untouched = !!orig && row.name.trim() === orig.name && row.publicName.trim() === orig.publicName;
  return untouched ? orig!.savedPublicName : row.publicName.trim();
}
