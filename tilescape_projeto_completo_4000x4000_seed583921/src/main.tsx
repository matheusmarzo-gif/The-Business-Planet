import {createRoot} from 'react-dom/client';
import AuthGate from './auth/AuthGate';
import App from './GameApp.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <AuthGate>
    {({ user, onSignOut, signOutError }) => (
      <App user={user} onSignOut={onSignOut} signOutError={signOutError} />
    )}
  </AuthGate>,
);
