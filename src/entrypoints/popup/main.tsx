import { render } from 'solid-js/web';
import App from './App';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Popup root element is missing');

render(() => <App />, root);
