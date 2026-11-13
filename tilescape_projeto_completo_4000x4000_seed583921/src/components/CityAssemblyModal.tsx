import { FormEvent, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  CityAssembly,
  MAX_CITY_MINIMUM_WAGE,
  MIN_CITY_MINIMUM_WAGE,
  parseCityMinimumWage,
} from '../types/city';

const money = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
interface CityAssemblyModalProps {
  city: CityAssembly | null;
  name: string;
  isMaster: boolean;
  isCreating: boolean;
  isBusy: boolean;
  error: string;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onSave: () => void;
  onSaveMinimumWage: (minimumWage: number) => void;
  onChooseLocation: () => void;
  onManageZones: () => void;
  onOpenConsumption: () => void;
}

export default function CityAssemblyModal({
  city,
  name,
  isMaster,
  isCreating,
  isBusy,
  error,
  onNameChange,
  onClose,
  onSave,
  onSaveMinimumWage,
  onChooseLocation,
  onManageZones,
  onOpenConsumption,
}: CityAssemblyModalProps) {
  const canEditName = isMaster && (isCreating || city !== null);
  const nameChanged = city !== null && name.trim() !== city.name;
  const [minimumWageDraft, setMinimumWageDraft] = useState(String(city?.minimumWage ?? MIN_CITY_MINIMUM_WAGE));
  const parsedMinimumWage = parseCityMinimumWage(Number(minimumWageDraft));
  const minimumWageChanged =
    city !== null && parsedMinimumWage !== null && parsedMinimumWage !== city.minimumWage;
  const populationChange = city?.populationChangeLastMonth ?? 0;

  useEffect(() => {
    setMinimumWageDraft(String(city?.minimumWage ?? MIN_CITY_MINIMUM_WAGE));
  }, [city?.id, city?.minimumWage]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCreating) onChooseLocation();
    else if (nameChanged) onSave();
  };

  return (
    <div className="city-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="city-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="city-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="city-modal-close" type="button" aria-label="Fechar" onClick={onClose}>
          <X size={18} />
        </button>
        <p className="auth-eyebrow">PREFEITURA · ESTRUTURA FUNDAMENTAL</p>
        <h2 id="city-modal-title">{isCreating ? 'Nova assembleia' : `Assembleia de ${city?.name}`}</h2>
        <p className="auth-description">
          {isCreating
            ? 'Defina o nome da cidade. Depois, escolha o centro da área municipal no mapa.'
            : `Área municipal de 303 × 303 tiles · Centro X ${city?.centerX}, Y ${city?.centerY}`}
        </p>

        {error && <p className="auth-message auth-error" role="alert">{error}</p>}

        <form className="city-details-form" onSubmit={handleSubmit}>
          <label>
            NOME DA CIDADE
            {canEditName ? (
              <input
                autoFocus
                maxLength={80}
                minLength={1}
                required
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
              />
            ) : (
              <strong>{city?.name}</strong>
            )}
          </label>

          <dl className="city-stat-list">
            <div><dt>POPULAÇÃO</dt><dd>{city?.population ?? 0}</dd></div>
            <div>
              <dt>
                {populationChange < 0
                  ? 'DECRESCIMENTO POPULACIONAL NO ÚLTIMO MÊS:'
                  : 'CRESCIMENTO POPULACIONAL NO ÚLTIMO MÊS:'}
              </dt>
              <dd>{Math.abs(populationChange)}</dd>
            </div>
            <div><dt>BEM-ESTAR</dt><dd>{money.format(city?.wellbeing ?? 0)}</dd></div>
            <div><dt>ECONOMIA</dt><dd>{city?.economy ?? 0}</dd></div>
            <div><dt>PESSOAS EMPREGADAS</dt><dd>{city?.employed ?? 0}</dd></div>
            <div><dt>OFERTAS DE EMPREGO</dt><dd>{city?.jobOffers ?? 0}</dd></div>
            <div><dt>SALÁRIO MÉDIO DIÁRIO</dt><dd>C$ {money.format(city?.averageWage ?? 0)}</dd></div>
            <div>
              <dt>SALÁRIO MÍNIMO DIÁRIO</dt>
              <dd>
                {isMaster && city ? (
                  <input
                    type="number"
                    min={MIN_CITY_MINIMUM_WAGE}
                    max={MAX_CITY_MINIMUM_WAGE}
                    step={0.01}
                    aria-label="Salário mínimo diário da cidade"
                    aria-invalid={parsedMinimumWage === null}
                    value={minimumWageDraft}
                    onChange={(event) => setMinimumWageDraft(event.target.value)}
                  />
                ) : (
                  `C$ ${money.format(city?.minimumWage ?? MIN_CITY_MINIMUM_WAGE)}`
                )}
              </dd>
            </div>
          </dl>

          {isMaster && city && parsedMinimumWage === null && (
            <small role="alert">
              Informe um valor entre C$ {money.format(MIN_CITY_MINIMUM_WAGE)} e C$ {money.format(MAX_CITY_MINIMUM_WAGE)}, com até 2 casas decimais.
            </small>
          )}

          {isMaster && city && (
            <button
              className="auth-submit"
              type="button"
              disabled={isBusy || !minimumWageChanged}
              onClick={() => {
                if (parsedMinimumWage !== null) onSaveMinimumWage(parsedMinimumWage);
              }}
            >
              Salvar salário mínimo
            </button>
          )}

          {city && (
            <button className="auth-submit city-consumption-button" type="button" onClick={onOpenConsumption}>
              Consumo
            </button>
          )}

          {isMaster && (
            <button className="auth-submit" type="submit" disabled={isBusy}>
              {isBusy
                ? 'Aguarde…'
                : isCreating
                  ? 'Escolher local no mapa'
                  : nameChanged
                    ? 'Salvar nome da cidade'
                    : 'Nome da cidade'}
            </button>
          )}
        </form>

        {isMaster && city && (
          <button className="auth-submit city-zone-manage-button" type="button" onClick={onManageZones}>
            Configurar áreas urbanas e rurais
          </button>
        )}

        <button className="auth-mode-toggle" type="button" onClick={onClose}>
          Fechar
        </button>
      </section>
    </div>
  );
}
