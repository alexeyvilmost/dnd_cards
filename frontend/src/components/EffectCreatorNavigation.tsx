import React from 'react';

interface EffectCreatorNavigationProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const sections = [
  {
    id: 'main',
    icon: '🏠',
    label: 'Основное',
    description: 'Название, описание, тип'
  },
  {
    id: 'properties',
    icon: '⚔️',
    label: 'Свойства',
    description: 'Устойчивость, иммунитет, уязвимость'
  }
];

export const EffectCreatorNavigation: React.FC<EffectCreatorNavigationProps> = ({
  activeSection,
  onSectionChange
}) => {
  return (
    <div className="w-16 bg-gray-50 rounded-lg shadow-sm border border-gray-200 flex flex-col items-center py-4 space-y-2">
      {sections.map((section) => (
        <button
          key={section.id}
          onClick={() => onSectionChange(section.id)}
          className={`
            relative group w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-all duration-200
            ${activeSection === section.id 
              ? 'bg-blue-100 text-blue-600 shadow-md' 
              : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-800'
            }
          `}
        >
          <span>{section.icon}</span>
          
          {/* Tooltip */}
          <div className="absolute left-full ml-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
            <div className="font-medium">{section.label}</div>
            <div className="text-xs text-gray-300">{section.description}</div>
            {/* Arrow */}
            <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
          </div>
        </button>
      ))}
    </div>
  );
};

