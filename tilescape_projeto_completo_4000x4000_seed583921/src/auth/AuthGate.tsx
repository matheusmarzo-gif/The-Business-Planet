import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { authClient, getAccessToken, verifyEmailCode } from './authClient';

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

type AuthMode =
  | 'sign-in'
  | 'sign-up'
  | 'forgot-password'
  | 'reset-password'
  | 'verify-email'
  | 'verify-email-code';
type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'error';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

function getPasswordResetState(): { mode: AuthMode; token: string } {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  return {
    mode: token || params.get('error') ? 'reset-password' : 'sign-in',
    token,
  };
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
  const [resetState] = useState(getPasswordResetState);
  const [mode, setMode] = useState<AuthMode>(resetState.mode);
  const [resetToken] = useState(resetState.token);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [errorMessage, setErrorMessage] = useState(() =>
    new URLSearchParams(window.location.search).has('error')
      ? 'Este link de redefinição é inválido ou expirou. Solicite um novo.'
      : '',
  );
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
      if (mode === 'verify-email') {
        const { error } = await authClient.sendVerificationEmail({
          email,
          callbackURL: `${window.location.origin}/`,
        });
        if (error) throw error;
        setVerificationCode('');
        setMode('verify-email-code');
        setNotice('Se este e-mail tiver uma conta pendente, enviaremos um código de confirmação.');
        return;
      }

      if (mode === 'verify-email-code') {
        await verifyEmailCode(email, verificationCode);
        const session = await authClient.getSession();
        if (session.error) throw session.error;
        if (session.data?.user) {
          const isMaster = await getMasterStatus();
          setUser({ email: session.data.user.email, name: session.data.user.name, isMaster });
          setMode('sign-in');
          setStatus('signed-in');
        } else {
          setMode('sign-in');
          setNotice('E-mail confirmado. Agora você pode entrar com sua senha.');
        }
        return;
      }

      if (mode === 'forgot-password') {
        const { error } = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/?view=reset-password`,
        });
        if (error) throw error;
        setNotice(
          'Se este e-mail estiver cadastrado, enviaremos um link para redefinir a senha. Verifique sua caixa de entrada.',
        );
        return;
      }

      if (mode === 'reset-password') {
        if (!resetToken) {
          throw new Error('Este link de redefinição é inválido ou expirou. Solicite um novo.');
        }
        const result = await authClient.resetPassword({
          newPassword: password,
          token: resetToken,
        });
        if (result.error) throw result.error;
        window.history.replaceState({}, '', window.location.pathname);
        setPassword('');
        setMode('sign-in');
        setNotice('Senha redefinida com sucesso. Entre com sua nova senha.');
        return;
      }

      const result =
        mode === 'sign-up'
          ? await authClient.signUp.email({ email, password, name })
          : await authClient.signIn.email({ email, password });
      if (result.error) throw result.error;
      if (mode === 'sign-up' && result.data?.user && !result.data.user.emailVerified) {
        setMode('verify-email-code');
        setVerificationCode('');
        setNotice('Enviamos um código de confirmação para seu e-mail.');
        return;
      }

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

  if (status === 'signed-in' && user && mode !== 'reset-password') {
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
            : mode === 'forgot-password'
              ? 'Informe seu e-mail cadastrado para receber um link de redefinição.'
              : mode === 'reset-password'
                ? 'Escolha uma nova senha para sua conta.'
                : mode === 'verify-email'
                  ? 'Informe o e-mail da conta para receber um código de confirmação.'
                  : mode === 'verify-email-code'
                    ? `Digite o código enviado para ${email}.`
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
          {mode === 'reset-password' ? (
            <label>
              Nova senha
              <input
                autoComplete="new-password"
                type="password"
                minLength={8}
                maxLength={128}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          ) : mode === 'verify-email-code' ? (
            <label>
              Código de confirmação
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
              />
            </label>
          ) : (
            <>
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
            {(mode === 'sign-in' || mode === 'sign-up') && (
              <label>
                Senha
                <input
                  autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                  type="password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            )}
          </>
          )}
          <button className="auth-submit" type="submit" disabled={isSubmitting || status === 'error'}>
          {isSubmitting
            ? 'Aguarde…'
            : mode === 'sign-up'
              ? 'Criar conta'
              : mode === 'forgot-password'
                ? 'Enviar link de redefinição'
                : mode === 'verify-email'
                  ? 'Enviar código de confirmação'
                  : mode === 'verify-email-code'
                    ? 'Confirmar e-mail'
                : mode === 'reset-password'
                  ? 'Salvar nova senha'
                  : 'Entrar'}
          </button>
        </form>

        <button
          className="auth-mode-toggle"
          type="button"
          disabled={isSubmitting}
          onClick={() => {
          setMode(
            mode !== 'sign-in'
              ? 'sign-in'
              : 'sign-up',
          );
          setErrorMessage('');
          setNotice('');
          }}
        >
          {mode !== 'sign-in'
          ? 'Voltar para entrar'
          : 'Ainda não tem conta? Criar conta'}
        </button>
        {mode === 'sign-in' && (
          <button
          className="auth-mode-toggle"
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            setMode('forgot-password');
            setErrorMessage('');
            setNotice('');
          }}
          >
          Esqueci minha senha
          </button>
        )}
        {mode === 'sign-in' && (
          <button
            className="auth-mode-toggle"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              setMode('verify-email');
              setErrorMessage('');
              setNotice('');
            }}
          >
            Reenviar código de confirmação
          </button>
        )}
      </section>
    </main>
  );
}
