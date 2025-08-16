import { RARITY_OPTIONS } from '../types';

interface RaritySelectorProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const RaritySelector = ({ value, onChange, error }: RaritySelectorProps) => {
  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'bg-gray-300';
      case 'uncommon': return 'bg-green-500';
      case 'rare': return 'bg-blue-500';
      case 'very_rare': return 'bg-purple-500';
      case 'artifact': return 'bg-yellow-500';
      default: return 'bg-gray-300';
    }
  };

  const getRarityTextColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'text-gray-600';
      case 'uncommon': return 'text-green-600';
      case 'rare': return 'text-blue-600';
      case 'very_rare': return 'text-purple-600';
      case 'artifact': return 'text-yellow-600';
      default: return 'text-gray-600';
    }
  };

  const getSelectedRarityLabel = () => {
    const selectedOption = RARITY_OPTIONS.find(option => option.value === value);
    return selectedOption?.label || '';
  };

  return (
    <div>
      <div className="flex items-center space-x-4">
        {/* Кружки редкости */}
        <div className="flex space-x-2">
          {RARITY_OPTIONS.map((option) => (
            <div
              key={option.value}
              className="flex flex-col items-center space-y-1 cursor-pointer"
              onClick={() => onChange(option.value)}
            >
              <div
                className={`w-8 h-8 rounded-full ${getRarityColor(option.value)} transition-all duration-200 ${
                  value === option.value 
                    ? 'ring-2 ring-black ring-offset-2' 
                    : 'hover:ring-2 hover:ring-gray-400 hover:ring-offset-1'
                }`}
              />
            </div>
          ))}
        </div>
        
        {/* Название выбранной редкости */}
        {value && (
          <div className="flex items-center space-x-2">
            <span className="text-gray-400">•</span>
            <span className={`font-medium ${getRarityTextColor(value)}`}>
              {getSelectedRarityLabel()}
            </span>
          </div>
        )}
        

      </div>
      
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};

export default RaritySelector;
