import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { authClient, getAccessToken } from './authClient';

interface AuthenticatedUser {
  email: string;
  name: string;
  isMaster: boolean;
}

interface AuthGateProps {
  children: (props: {
    user: AuthenticatedUser;
    onSignOut: () => Promise<void>;
    signOutError: string;
  }) => ReactNode;
}

type AuthMode = 'sign-in' | 'sign-up';
type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'error';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

async function getMasterStatus(): Promise<boolean> {
  const token = await getAccessToken();
  const response = await fetch('/api/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error('Não foi possível verificar as permissões desta conta.');
  }
  const result: unknown = await response.json();
  if (typeof result !== 'object' || result === null) {
    throw new Error('O servidor retornou permissões inválidas.');
  }
  const isMaster = (result as Record<string, unknown>).isMaster;
  if (typeof isMaster !== 'boolean') {
    throw new Error('O servidor retornou permissões inválidas.');
  }
  return isMaster;
}

export default function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const restoreSession = async () => {
    setStatus('loading');
    setErrorMessage('');
    try {
      const { data, error } = await authClient.getSession();
      if (error) throw error;
      if (data?.user) {
        const isMaster = await getMasterStatus();
        setUser({ email: data.user.email, name: data.user.name, isMaster });
        setStatus('signed-in');
      } else {
        setUser(null);
        setStatus('signed-out');
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setStatus('error');
    }
  };

  useEffect(() => {
    void restoreSession();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setNotice('');

    try {
      const result =
        mode === 'sign-up'
          ? await authClient.signUp.email({ email, password, name })
          : await authClient.signIn.email({ email, password });
      if (result.error) throw result.error;

      const session = await authClient.getSession();
      if (session.error) throw session.error;
      if (!session.data?.user) {
        setNotice(
          mode === 'sign-up'
            ? 'Cadastro iniciado. Se a verificação de e-mail estiver ativa, confirme seu endereço e entre novamente.'
            : 'Não foi possível confirmar a sessão. Tente entrar novamente.',
        );
        setMode('sign-in');
        return;
      }

      const isMaster = await getMasterStatus();
      setUser({ email: session.data.user.email, name: session.data.user.name, isMaster });
      setStatus('signed-in');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const { error } = await authClient.signOut();
      if (error) throw error;
      setUser(null);
      setStatus('signed-out');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'signed-in' && user) {
    return children({ user, onSignOut: handleSignOut, signOutError: errorMessage });
  }

  if (status === 'loading') {
    return (
      <main className="auth-screen">
        <section className="auth-card" aria-live="polite">
          <p className="auth-eyebrow">VALDORA · MUNDO COMPARTILHADO</p>
          <h1>Verificando seu acesso</h1>
          <p className="auth-description">Conectando à sua sessão segura.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <p className="auth-eyebrow">VALDORA · MUNDO COMPARTILHADO</p>
        <h1>{mode === 'sign-up' ? 'Criar sua conta' : 'Entre em Valdora'}</h1>
        <p className="auth-description">
          {mode === 'sign-up'
            ? 'Crie uma conta para explorar as terras do reino.'
            : 'Entre para continuar sua jornada pelas terras do reino.'}
        </p>

        {status === 'error' && (
          <div className="auth-message auth-error" role="alert">
            <span>{errorMessage}</span>
            <button type="button" onClick={() => void restoreSession()}>
              Tentar novamente
            </button>
          </div>
        )}
        {errorMessage && status !== 'error' && (
          <p className="auth-message auth-error" role="alert">{errorMessage}</p>
        )}
        {notice && <p className="auth-message auth-notice" role="status">{notice}</p>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'sign-up' && (
            <label>
              Nome
              <input
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <label>
            E-mail
            <input
              autoComplete="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Senha
            <input
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              type="password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="auth-submit" type="submit" disabled={isSubmitting || status === 'error'}>
            {isSubmitting
              ? 'Aguarde…'
              : mode === 'sign-up'
                ? 'Criar conta'
                : 'Entrar'}
          </button>
        </form>

        <button
          className="auth-mode-toggle"
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
            setErrorMessage('');
            setNotice('');
          }}
        >
          {mode === 'sign-up' ? 'Já tem uma conta? Entrar' : 'Ainda não tem conta? Criar conta'}
        </button>
      </section>
    </main>
  );
}
