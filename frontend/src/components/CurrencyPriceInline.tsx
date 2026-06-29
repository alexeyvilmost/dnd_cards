import { getCurrencyInfo, formatPriceAmount, currencyIconStyle } from '../utils/currencies';

interface CurrencyPriceInlineProps {
  price: number;
  currency?: string | null;
  abbreviate?: boolean | null;
  iconClassName?: string;
  textClassName?: string;
}

const CurrencyPriceInline = ({
  price,
  currency,
  abbreviate,
  iconClassName = 'w-3 h-3',
  textClassName = 'font-bold',
}: CurrencyPriceInlineProps) => {
  const cur = getCurrencyInfo(currency);
  const showAbbreviated = abbreviate !== false;

  return (
    <>
      <span className={textClassName} style={{ color: cur.color }}>
        {formatPriceAmount(price, showAbbreviated)}
      </span>
      <img src={cur.icon} alt={cur.label} className={iconClassName} style={currencyIconStyle} />
    </>
  );
};

export default CurrencyPriceInline;
