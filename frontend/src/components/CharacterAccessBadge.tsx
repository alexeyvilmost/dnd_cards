import { isCharacterReadOnly, type ForgeCharacter } from '../character/types';

export const LEGACY_READ_ONLY_LABEL = 'Архивный публичный лист · только чтение';

export default function CharacterAccessBadge({
  character,
}: {
  character: Pick<ForgeCharacter, 'access_mode'>;
}) {
  if (!isCharacterReadOnly(character)) return null;
  return (
    <span
      role="status"
      className="character-access-badge"
      title="Изменение этого архивного публичного листа отключено; создайте свою копию."
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        width: 'fit-content',
        padding: '3px 8px',
        border: '1px solid #b8863b',
        borderRadius: 999,
        color: '#f0c879',
        fontSize: 12,
        lineHeight: 1.25,
      }}
    >
      {character.access_mode === 'legacy_public_readonly'
        ? LEGACY_READ_ONLY_LABEL
        : 'Доступ на изменение не подтверждён · только чтение'}
    </span>
  );
}
