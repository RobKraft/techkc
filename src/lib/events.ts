export interface EventLike {
  name: string;
  group?: string;
}

/**
 * "Group: Title" when the group adds information, otherwise just the title —
 * avoids "SecureWorld: SecureWorld Kansas City"-style duplication when the
 * event name already names its own group.
 */
export function eventDisplayTitle(ev: EventLike): string {
  if (!ev.group) return ev.name;
  const redundant = ev.name.toLowerCase().includes(ev.group.toLowerCase());
  return redundant ? ev.name : `${ev.group}: ${ev.name}`;
}
