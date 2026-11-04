import { FormEvent } from 'react';
import { X } from 'lucide-react';
import { CityAssembly } from '../types/city';

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
  onChooseLocation: () => void;
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
  onChooseLocation,
}: CityAssemblyModalProps) {
  const canEditName = isMaster && (isCreating || city !== null);
  const nameChanged = city !== null && name.trim() !== city.name;

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
            <div><dt>BEM-ESTAR</dt><dd>{city?.wellbeing ?? 0}</dd></div>
            <div><dt>ECONOMIA</dt><dd>{city?.economy ?? 0}</dd></div>
          </dl>

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

        <button className="auth-mode-toggle" type="button" onClick={onClose}>
          Fechar
        </button>
      </section>
    </div>
  );
}
