import {createPortal} from 'react-dom';
import DialogShell from '../DialogShell';
import ImageUploader from '../ImageUploader';
import '../../contexts/DiceDialog.css';

export default function ForgeTokenDialog({imageUrl, onChange, onClose, paperMode}: {
  imageUrl?: string; onChange: (url: string) => void; onClose: () => void; paperMode?: boolean;
}) {
  const label = paperMode ? 'Портрет персонажа' : 'Токен на поле боя';
  return createPortal(<DialogShell label={label} onCancel={onClose} className="forge-token-dialog">
    <h2 className="dice-dialog-title">{label}</h2>
    <ImageUploader currentImageUrl={imageUrl} onImageUpload={onChange} className="forge-token-uploader" />
    <p className="forge-token-hint">{paperMode ? 'Изображение появится на странице портрета.' : 'Квадратное изображение лучше всего читается на сетке.'}</p>
    <div className="dice-dialog-actions"><button type="button" className="dice-dialog-btn primary" onClick={onClose}>Готово</button></div>
  </DialogShell>, document.body);
}
