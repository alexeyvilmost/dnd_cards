/** Small vector vocabulary shared by spell impacts, projectiles and utility actions.
 * Selection belongs to animation metadata; no entity identities enter this renderer. */
export default function CombatAnimationGlyph({motif}: {motif?: string}) {
  switch (motif) {
    case 'fire': return <path d="M0 -34 C20 -12 5 -7 20 2 C38 28 9 41 -10 29 C-30 18 -14 -5 -11 -11 C-8 5 5 7 0 -34Z"/>;
    case 'frost': return <g fill="none"><path d="M0 -34V34 M-29 -17L29 17 M-29 17L29 -17"/><path d="M-8 -25L0 -17L8 -25 M-8 25L0 17L8 25 M-26 -3L-15 -9L-15 -21 M26 3L15 9L15 21 M-26 3L-15 9L-15 21 M26 -3L15 -9L15 -21"/></g>;
    case 'lightning': return <path d="M9 -38L-24 7H-4L-12 38L25 -10H5Z"/>;
    case 'acid': return <g><path d="M0 -33C-5 -19 -24 0 -24 12A24 24 0 0 0 24 12C24 0 5 -19 0 -33Z"/><circle cx="-8" cy="12" r="4" fill="var(--fx-secondary)"/><circle cx="8" cy="19" r="3" fill="var(--fx-secondary)"/></g>;
    case 'poison': return <g><path d="M-22 0C-32 -29 29 -34 23 0L16 10V23H-16V10Z"/><circle cx="-9" cy="-3" r="6" fill="var(--fx-secondary)"/><circle cx="10" cy="-3" r="6" fill="var(--fx-secondary)"/><path d="M-7 24V33M6 24V33"/></g>;
    case 'radiant': return <g><path d="M0 -30L7 -7L30 0L7 7L0 30L-7 7L-30 0L-7 -7Z"/><circle r="21" fill="none"/><path d="M0 -39V-33M0 33V39M-39 0H-33M33 0H39"/></g>;
    case 'necrotic': return <g fill="none"><path d="M0 -31C-38 -28 -31 22 0 31C31 22 38 -28 0 -31Z M-17 -11L-6 2M17 -11L6 2 M-9 17Q0 8 9 17"/><path d="M-23 -32L-34 -42M23 -32L34 -42M0 31V43"/></g>;
    case 'psychic': return <g fill="none"><path d="M-38 0Q0 -39 38 0Q0 39 -38 0Z"/><circle r="12"/><path d="M-25 -24L-32 -32M25 -24L32 -32M0 -27V-38"/></g>;
    case 'thunder': return <g fill="none"><path d="M-7 -25Q19 0 -7 25 M5 -35Q42 0 5 35 M-20 -13Q-7 0 -20 13"/></g>;
    case 'nature': return <g><path d="M-25 26C-41 -10 -3 -34 29 -30C34 -1 21 35 -25 26Z"/><path d="M-32 35L18 -19M-13 16L-15 -7M0 4L21 5" fill="none" stroke="var(--fx-secondary)"/></g>;
    case 'water': return <g fill="none"><path d="M-36 4Q-23 -12 -10 4T16 4T42 4 M-36 20Q-23 4 -10 20T16 20T42 20 M-10 -10Q10 -35 14 -10"/></g>;
    case 'earth': return <g><path d="M-33 18L-21 -17L4 -31L30 -8L35 23L2 32Z"/><path d="M-21 -17L-5 1L30 -8M-5 1L2 32" fill="none" stroke="var(--fx-secondary)"/></g>;
    case 'wind': return <g fill="none"><path d="M-38 -12H15Q39 -12 31 -28Q22 -39 14 -25 M-31 0H28Q48 0 38 15 M-38 12H6Q27 12 15 30Q5 40 -2 27"/></g>;
    case 'illusion': return <g fill="none"><path d="M0 -33L31 -15V19L0 36L-31 19V-15Z M0 2L31 -15M0 2L-31 -15M0 2V36"/><path d="M-19 -28L12 -10" strokeDasharray="4 6"/></g>;
    case 'healing': return <path d="M-9 -31H9V-9H31V9H9V31H-9V9H-31V-9H-9Z"/>;
    default: return <g><path d="M0 -32L9 -9L32 0L9 9L0 32L-9 9L-32 0L-9 -9Z"/><circle r="22" fill="none" strokeDasharray="4 9"/></g>;
  }
}
