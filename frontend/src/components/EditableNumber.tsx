import React, { useState, useRef, useEffect } from 'react';

interface EditableNumberProps {
  value: number;
  onChange: (newValue: number) => void;
  min?: number;
  max?: number;
  className?: string;
  disabled?: boolean;
}

const EditableNumber: React.FC<EditableNumberProps> = ({
  value,
  onChange,
  min = 1,
  max = 30,
  className = '',
  disabled = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value.toString());
  const inputRef = useRef<HTMLInputElement>(null);

  // Фокус на input при входе в режим редактирования
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Обновляем editValue при изменении value извне
  useEffect(() => {
    setEditValue(value.toString());
  }, [value]);

  const handleClick = () => {
    if (!disabled) {
      setIsEditing(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const handleSave = () => {
    const numValue = parseInt(editValue, 10);
    
    if (!isNaN(numValue) && numValue >= min && numValue <= max) {
      onChange(numValue);
      setEditValue(numValue.toString()); // Обновляем editValue новым значением
      setIsEditing(false);
    } else {
      // Если значение некорректное, возвращаем исходное
      setEditValue(value.toString());
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value.toString());
    setIsEditing(false);
  };

  const handleBlur = () => {
    handleSave();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={editValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        min={min}
        max={max}
        className={`text-center bg-white border border-blue-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 ${className}`}
        style={{ 
          width: '2rem',
          // Скрываем стрелочки для всех браузеров
          MozAppearance: 'textfield',
          WebkitAppearance: 'none',
          appearance: 'textfield'
        }}
      />
    );
  }

  return (
    <div
      onClick={handleClick}
      className={`cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 transition-colors ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
      title={disabled ? '' : 'Нажмите для редактирования'}
    >
      {value}
    </div>
  );
};

export default EditableNumber;
