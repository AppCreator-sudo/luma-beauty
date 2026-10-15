import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/300-italic.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/700.css';
import { Shell, Loading } from './components/Shell';
import './styles.css';
import './profile-settings.css';
import './master-search.css';
import './salon.css';
import './auth.css';
import './promotions.css';
import './address-fields.css';
import './ui-density.css';
import './compact-select.css';

const HomePage = lazy(() => import('./pages/Discover').then(module => ({ default: module.HomePage })));
const MastersPage = lazy(() => import('./pages/Discover').then(module => ({ default: module.MastersPage })));
const InspirationPage = lazy(() => import('./pages/Discover').then(module => ({ default: module.InspirationPage })));
const ProfilePage = lazy(() => import('./pages/Profile').then(module => ({ default: module.ProfilePage })));
const WorkPage = lazy(() => import('./pages/Profile').then(module => ({ default: module.WorkPage })));
const BookingPage = lazy(() => import('./pages/Booking').then(module => ({ default: module.BookingPage })));
const VisitPage = lazy(() => import('./pages/Booking').then(module => ({ default: module.VisitPage })));
const AuthPage = lazy(() => import('./pages/Auth').then(module => ({ default: module.AuthPage })));
const AccessPage = lazy(() => import('./pages/Access').then(module => ({ default: module.AccessPage })));
const AccountPage = lazy(() => import('./pages/Account').then(module => ({ default: module.AccountPage })));
const StudioPage = lazy(() => import('./pages/Studio').then(module => ({ default: module.StudioPage })));
const CalendarPage = lazy(() => import('./pages/Studio').then(module => ({ default: module.CalendarPage })));
const SalonPage = lazy(() => import('./pages/Salon').then(module => ({ default: module.SalonPage })));
const JoinPage = lazy(() => import('./pages/Join').then(module => ({ default: module.JoinPage })));
const PublicSalonPage = lazy(() => import('./pages/PublicSalon').then(module => ({ default: module.PublicSalonPage })));
const SalonBookingPage = lazy(() => import('./pages/PublicSalon').then(module => ({ default: module.SalonBookingPage })));
const MapPage = lazy(() => import('./pages/Map').then(module => ({ default: module.MapPage })));

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter basename="/v2"><Suspense fallback={<Loading/>}><Routes><Route element={<Shell/>}><Route index element={<HomePage/>}/><Route path="masters" element={<MastersPage/>}/><Route path="inspiration" element={<InspirationPage/>}/><Route path="map" element={<MapPage/>}/><Route path="m/:slug" element={<ProfilePage/>}/><Route path="w/:id" element={<WorkPage/>}/><Route path="book/:slug" element={<BookingPage/>}/><Route path="visit" element={<VisitPage/>}/><Route path="auth" element={<AuthPage/>}/><Route path="access" element={<AccessPage/>}/><Route path="me" element={<AccountPage/>}/><Route path="studio" element={<StudioPage/>}/><Route path="calendar" element={<CalendarPage/>}/><Route path="salon" element={<SalonPage/>}/><Route path="join" element={<JoinPage/>}/><Route path="s/:slug" element={<PublicSalonPage/>}/><Route path="s/:slug/book" element={<SalonBookingPage/>}/><Route path="*" element={<HomePage/>}/></Route></Routes></Suspense></BrowserRouter></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
import './lib/useClientDraft';
