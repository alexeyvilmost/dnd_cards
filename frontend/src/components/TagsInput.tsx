import React, { useState, useEffect } from 'react';

interface TagsInputProps {
  value?: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
}

const TagsInput: React.FC<TagsInputProps> = ({
  value = [],
  onChange,
  placeholder = "Введите теги через запятую",
  className = ""
}) => {
  const [inputValue, setInputValue] = useState('');

  // Обновляем inputValue при изменении value
  useEffect(() => {
    setInputValue(value.join(', '));
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleBlur = () => {
    // Разбиваем строку на теги, убираем пробелы и пустые значения
    const tags = inputValue
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
    
    onChange(tags);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBlur();
    }
  };

  return (
    <div className={className}>
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyPress={handleKeyPress}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder={placeholder}
      />
      <p className="text-xs text-gray-500 mt-1">
        Укажите теги через запятую для дополнительной информации о предмете
      </p>
    </div>
  );
};

export default TagsInput;
