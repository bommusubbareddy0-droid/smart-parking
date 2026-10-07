import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import './parkly.css';
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { useSignIn } from '@clerk/react/legacy';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Building2,
  CalendarDays, CarFront, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Clock3, CreditCard, ExternalLink, Gauge, KeyRound, LocateFixed, MapPin, Menu,
  List, Map, Navigation, ParkingCircle, Phone, Search, ShieldCheck, SlidersHorizontal, Sparkles,
  Star, TicketCheck, X,
} from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { io } from 'socket.io-client';
import {
  getGetAdminSummaryQueryKey, getGetDashboardSummaryQueryKey, getGetEntranceBoardQueryKey,
  getGetOwnerLocationsQueryKey, getGetParkingLocationQueryKey, getListParkingLocationsQueryKey,
  getListReservationsQueryKey, useCancelReservation, useCreateReservation, useGetAdminSummary,
  useGetDashboardSummary, useGetEntranceBoard, useGetOwnerLocations, useGetParkingLocation,
  useListParkingLocations, useListReservations, useStartPhoneVerification, useUpdateBayStatus,
  useVerifyPhoneCode,
} from '@workspace/api-client-react';
import type { EntranceBoard, ParkingBay, ParkingBayStatus, ParkingLocation, Reservation } from '@workspace/api-client-react';
import { Toaster, toast } from 'sonner';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
const currentReturnPath = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
const signInHref = (path = '/sign-in') => `${path}?redirect_url=${encodeURIComponent(currentReturnPath())}`;
const safeAuthRedirect = () => {
  const fallback = `${basePath}/dashboard` || '/dashboard';
  const requested = new URLSearchParams(window.location.search).get('redirect_url');
  if (!requested) return fallback;
  try {
    const target = new URL(requested, window.location.origin);
    const inArtifact = !basePath || target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
    const route = stripBase(target.pathname);
    if (target.origin !== window.location.origin || !inArtifact || route.startsWith('/sign-in') || route.startsWith('/sign-up')) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
};

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#0B1528', colorForeground: '#15243a', colorMutedForeground: '#667080',
    colorDanger: '#d85d4e', colorBackground: '#fbf8f1', colorInput: '#fffdf8',
    colorInputForeground: '#15243a', colorNeutral: '#ded9ce', fontFamily: 'DM Sans',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbf8f1] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#0b1528] font-semibold', headerSubtitle: 'text-[#606b7a]',
    socialButtonsBlockButtonText: 'text-[#15243a] font-medium', formFieldLabel: 'text-[#15243a]',
    footerActionLink: 'text-[#315510] font-semibold', footerActionText: 'text-[#606b7a]',
    dividerText: 'text-[#68717c]', identityPreviewEditButton: 'text-[#315510]',
    formFieldSuccessText: 'text-[#315510]', alertText: 'text-[#9c342d]',
    logoBox: 'mb-2', logoImage: 'max-h-9', socialButtonsBlockButton: 'border-[#dcd7cb] bg-[#fffdf8]',
    formButtonPrimary: 'bg-[#0b1528] text-[#f8f4e9] hover:bg-[#172a49]',
    formFieldInput: 'border-[#dcd7cb] bg-[#fffdf8] text-[#15243a]',
    footerAction: 'border-t border-[#e5e0d6]', dividerLine: 'bg-[#ded9ce]',
    alert: 'border-[#edc8c2] bg-[#fff4f1]', otpCodeFieldInput: 'border-[#dcd7cb] bg-[#fffdf8]',
    formFieldRow: 'mb-4', main: 'gap-4',
  },
};

const money = (value: number, currency = 'INR') => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency, maximumFractionDigits: 0,
}).format(value);
const dateTime = (value: string) => new Intl.DateTimeFormat('en-IN', {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));
const dateOnly = (value: string) => new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric',
}).format(new Date(value));

function useLiveBayUpdates(locationId: string) {
  const client = useQueryClient();
  useEffect(() => {
    if (!locationId) return;
    const socket = io({ path: `${basePath}/api/socket.io`, transports: ['websocket', 'polling'] });
    const join = () => socket.emit('join-location', locationId);
    socket.on('connect', join);
    socket.on('bay:updated', (event: { locationId: string; bay: ParkingBay; updatedAt: string }) => {
      if (event.locationId !== locationId) return;
      client.setQueryData<EntranceBoard>(getGetEntranceBoardQueryKey(locationId), (previous) => {
        if (!previous) return previous;
        const bays = previous.bays.map(bay => bay.id === event.bay.id ? event.bay : bay);
        return { ...previous, bays, freeBays: bays.filter(bay => bay.status === 'free').length, updatedAt: event.updatedAt };
      });
    });
    return () => { socket.off('connect', join); socket.disconnect(); };
  }, [client, locationId]);
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={`brand-mark ${inverse ? 'brand-inverse' : ''}`} data-testid="link-parkly-home">
    <span className="brand-symbol"><ParkingCircle size={21} strokeWidth={2.2} /></span>
    <span>parkly<span className="brand-period">.</span></span>
  </Link>;
}

function Header() {
  const [mobile, setMobile] = useState(false);
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const role = user?.publicMetadata.role;
  return <header className="site-header">
    <div className="shell header-inner">
      <Brand />
      <nav className={`header-nav ${mobile ? 'nav-open' : ''}`} aria-label="Main navigation" onClick={event => { if ((event.target as HTMLElement).closest('a')) setMobile(false); }}>
        <Link href="/search" data-testid="link-search-nav">Find parking</Link>
        {isSignedIn ? <>
          <Link href="/dashboard" data-testid="link-dashboard-nav">My passes</Link>
          {role === 'owner' && <Link href="/owner" data-testid="link-owner-nav">Owner studio</Link>}
          {role === 'admin' && <Link href="/admin" data-testid="link-admin-nav">Platform</Link>}
        </> : <Link href="/help" data-testid="link-help-nav">How it works</Link>}
        <Link href="/help" className="nav-help" data-testid="link-help-secondary">Help</Link>
      </nav>
      <div className="header-actions">
        {isSignedIn ? <>
          <span className="user-greeting">{user?.firstName ? `Hi, ${user.firstName}` : 'Welcome back'}</span>
          <button className="button button-outline button-small" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">Sign out</button>
        </> : <>
          <Link href="/sign-in" className="signin-link" data-testid="link-sign-in">Sign in</Link>
          <Link href="/sign-up" className="button button-dark button-small" data-testid="link-get-started">Get started</Link>
        </>}
      </div>
      <button className="mobile-menu" onClick={() => setMobile(!mobile)} aria-label={mobile ? 'Close navigation' : 'Open navigation'} aria-expanded={mobile} data-testid="button-mobile-menu">
        {mobile ? <X size={21} /> : <Menu size={21} />}
      </button>
    </div>
  </header>;
}

function Footer() {
  return <footer className="site-footer"><div className="shell footer-main">
    <div><Brand inverse /><p>Less circling. More arriving.</p></div>
    <div className="footer-links">
      <Link href="/help" data-testid="link-footer-help">Help & support</Link>
      <Link href="/privacy" data-testid="link-footer-privacy">Privacy</Link>
      <Link href="/terms" data-testid="link-footer-terms">Terms</Link>
    </div>
    <span className="footer-note">Made for the way India moves.</span>
  </div></footer>;
}

function Layout({ children, noFooter = false }: { children: ReactNode; noFooter?: boolean }) {
  return <div className="app-frame parkly-grain"><Header /><main>{children}</main>{!noFooter && <Footer />}</div>;
}

function AccountGate({ children, role }: { children: ReactNode; role?: 'owner' | 'admin' }) {
  const { isLoaded, isSignedIn, user } = useUser();
  if (!isLoaded) return <Layout><LoadingState label="Checking your account" /></Layout>;
  if (!isSignedIn) return <Layout><div className="shell account-gate"><div className="state-panel">
    <div className="state-icon lime"><KeyRound size={21} /></div><h3>Sign in to continue</h3><p>Sign in to view your passes and manage parking reservations.</p>
    <div className="account-gate-actions"><Link className="button button-dark" href={signInHref()}>Sign in or create an account</Link><Link className="button button-outline" href={signInHref('/sign-in/phone')}>Use your phone</Link></div>
  </div></div></Layout>;
  if (role && user?.publicMetadata.role !== role) return <Layout><div className="shell account-gate"><div className="state-panel">
    <div className="state-icon coral"><ShieldCheck size={21} /></div><h3>This area is restricted</h3><p>Your account does not have {role} access.</p><Link className="button button-dark" href="/">Back to parking search</Link>
  </div></div></Layout>;
  return <>{children}</>;
}

function LoadingState({ label = 'Finding the right space' }: { label?: string }) {
  return <div className="shell state-wrap" role="status" data-testid="status-loading">
    <div className="skeleton skeleton-title" /><p>{label}…</p>
    <div className="skeleton-row"><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /></div>
  </div>;
}
function ErrorState({ message = 'We couldn’t load this just now.', retry }: { message?: string; retry: () => void }) {
  return <div className="state-panel" role="alert" data-testid="status-error">
    <div className="state-icon coral"><Activity size={22} /></div><h3>That didn’t quite land.</h3><p>{message}</p>
    <button className="button button-dark" onClick={retry} data-testid="button-retry">Try again</button>
  </div>;
}
function EmptyState({ title, note }: { title: string; note: string }) {
  return <div className="state-panel" data-testid="status-empty"><div className="state-icon lime"><LocateFixed size={23} /></div><h3>{title}</h3><p>{note}</p></div>;
}

function SearchBar({ initialCity = '', initialQuery = '', compact = false, onSearch }: { initialCity?: string; initialQuery?: string; compact?: boolean; onSearch?: (city: string, query: string) => void }) {
  const [, setLocation] = useLocation();
  const [city, setCity] = useState(initialCity);
  const [query, setQuery] = useState(initialQuery);
  useEffect(() => { setCity(initialCity); }, [initialCity]);
  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onSearch) onSearch(city, query);
    else setLocation(`/search?city=${encodeURIComponent(city)}&q=${encodeURIComponent(query)}`);
  };
  return <form className={`searchbar ${compact ? 'searchbar-compact' : ''}`} onSubmit={submit} data-testid="form-parking-search">
    <label className="search-field">
      <span className="search-icon"><MapPin size={19} /></span><span className="field-copy"><small>Where to?</small>
        <input aria-label="City or destination" placeholder="City or destination" value={city} onChange={e => setCity(e.target.value)} list="parkly-cities" data-testid="input-search-city" /></span>
      <datalist id="parkly-cities"><option value="Mumbai" /><option value="Bengaluru" /><option value="Delhi" /><option value="Hyderabad" /><option value="Pune" /><option value="Chennai" /><option value="Kolkata" /><option value="Goa" /></datalist>
    </label>
    <span className="search-divider" />
    <label className="search-field search-destination"><span className="search-icon"><Search size={18} /></span><span className="field-copy"><small>Near a place</small>
      <input aria-label="Landmark or address" placeholder="Landmark, street, or area" value={query} onChange={e => setQuery(e.target.value)} data-testid="input-search-query" /></span></label>
    <button type="submit" className="button button-lime search-submit" data-testid="button-search-parking"><Search size={17} /><span>Search spaces</span></button>
  </form>;
}

function ListingCard({ location }: { location: ParkingLocation }) {
  const image = location.imageUrl?.trim();
  return <article className="listing-card" data-testid={`card-location-${location.id}`}>
    <Link href={`/parking/${location.id}`} className="listing-image-wrap" aria-label={`View ${location.name}`} data-testid={`link-location-${location.id}`}>
      {image ? <img className="listing-image" src={image} alt={`${location.name} parking entrance`} loading="lazy" /> : <div className="image-fallback"><Building2 size={34} /><span>{location.city}</span></div>}
      <span className="availability-chip"><span className="live-dot" />{location.freeBays} free now</span>
      {location.estimateOnly && <span className="estimate-chip">Estimate</span>}
    </Link>
    <div className="listing-content">
      <div className="listing-title-row"><div><p className="eyebrow">{location.city} <span>·</span> {location.driveMinutes} min drive</p>
        <Link href={`/parking/${location.id}`} className="listing-title" data-testid={`link-location-title-${location.id}`}>{location.name}</Link></div>
        <span className="rating"><Star size={14} fill="currentColor" /> {location.rating.toFixed(1)}</span></div>
      <p className="listing-address">{location.address}</p>
      <div className="listing-bottom"><div><strong>{money(location.rate, location.currency)}</strong><span> / hour</span></div>
        <span className="bay-count">{location.freeBays} of {location.totalBays} bays</span></div>
    </div>
  </article>;
}

function LocationResults({ locations, loading, error, retry }: { locations: ParkingLocation[] | undefined; loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <div className="results-grid"><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /></div>;
  if (error) return <ErrorState retry={retry} />;
  if (!locations?.length) return <EmptyState title="No spaces in this search" note="Try a nearby area or another city. New places are joining Parkly every day." />;
  return <div className="results-grid">{locations.map(item => <ListingCard key={item.id} location={item} />)}</div>;
}

function MapResults({ locations, loading, error, retry }: { locations: ParkingLocation[]; loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <div className="results-grid"><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /></div>;
  if (error) return <ErrorState retry={retry} />;
  if (!locations.length) return <EmptyState title="No spaces in this search" note="Try a nearby area or another city. New places are joining Parkly every day." />;
  const minLat = Math.min(...locations.map(location => location.latitude));
  const maxLat = Math.max(...locations.map(location => location.latitude));
  const minLng = Math.min(...locations.map(location => location.longitude));
  const maxLng = Math.max(...locations.map(location => location.longitude));
  return <div className="map-results-layout" data-testid="view-map-results">
    <section className="map-preview" aria-label="Illustrative map of available parking">
      <div className="map-preview-label"><span className="eyebrow">PARKING MAP</span><span>Illustrative · drive times are estimates</span></div>
      <div className="map-preview-canvas">
        <svg className="map-road-lines" viewBox="0 0 800 500" preserveAspectRatio="none" aria-hidden="true">
          <path d="M-30 100 C190 150 250 10 420 98 S660 140 840 40M-30 340 C170 280 275 420 440 315 S650 270 840 380M90 -20 C170 135 60 295 190 520M410 -20 C335 155 510 290 450 520M690 -20 C570 130 750 300 635 520" />
          <path className="map-road-major" d="M-20 230 C175 170 245 270 390 220 S640 150 820 250" />
        </svg>
        <span className="map-neighbourhood neighbourhood-one">CITY CENTRE</span><span className="map-neighbourhood neighbourhood-two">PARK DISTRICT</span><span className="map-neighbourhood neighbourhood-three">RIVER WALK</span>
        {locations.map((location, index) => {
          const x = maxLng === minLng ? 50 : 13 + ((location.longitude - minLng) / (maxLng - minLng)) * 74;
          const y = maxLat === minLat ? 50 : 17 + ((maxLat - location.latitude) / (maxLat - minLat)) * 66;
          return <Link href={`/parking/${location.id}`} key={location.id} className="map-pin" style={{ left: `${x}%`, top: `${y}%` }} aria-label={`Open ${location.name}, ${money(location.rate, location.currency)} per hour`} title={`${location.name} · ${money(location.rate, location.currency)}/hr`} data-testid={`map-pin-${location.id}`}><MapPin size={14} /><span>{index + 1}</span></Link>;
        })}
      </div>
      <div className="map-preview-foot"><span><i className="legend-free" />Available parking</span><span><LocateFixed size={14} /> Route guidance is not live</span></div>
    </section>
    <aside className="map-result-list" aria-label="Parking locations on the map">
      <span className="eyebrow">SPACES ON THIS MAP</span>
      {locations.map((location, index) => <Link href={`/parking/${location.id}`} key={location.id} className="map-result-row" data-testid={`map-result-${location.id}`}>
        <span className="map-result-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{location.name}</strong><small>{location.city} · {location.freeBays} free</small></span><b>{money(location.rate, location.currency)}<small>/hr</small></b>
      </Link>)}
    </aside>
  </div>;
}

function LandingPage() {
  const locationsQuery = useListParkingLocations();
  const [, setLocation] = useLocation();
  const locations = locationsQuery.data;
  const featured = locations?.slice(0, 3);
  return <Layout>
    <section className="hero-section">
      <div className="hero-ambient" aria-hidden="true"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-pin"><ParkingCircle size={26} /></div></div>
      <div className="shell hero-grid">
        <div className="hero-copy page-enter"><span className="eyebrow eyebrow-light"><span className="live-dot" /> PARKING, WITHOUT THE GUESSWORK</span>
          <h1>Arrive like<br />you <em>belong.</em></h1>
          <p>Find a space, reserve your bay, and know exactly where to go. Good journeys start before you turn the key.</p>
          <div className="hero-proof"><div className="proof-icon"><ShieldCheck size={18} /></div><span>Verified spaces.<br /><strong>Clear before you go.</strong></span></div>
        </div>
        <div className="hero-search-card page-enter"><div className="search-card-top"><div><span className="eyebrow">YOUR NEXT STOP</span><h2>Where are you headed?</h2></div><span className="search-card-mark"><Navigation size={20} /></span></div>
          <SearchBar />
          <div className="popular-destinations"><span>Popular:</span>{['Mumbai', 'Bengaluru', 'Delhi'].map((name, index) =>
            <button key={name} onClick={() => setLocation(`/search?city=${encodeURIComponent(name)}`)} data-testid={`button-popular-${name.toLowerCase()}`}>{name}{index < 2 && <span>·</span>}</button>)}</div>
        </div>
        <div className="hero-caption mono-font">01 / A BETTER WAY TO PARK</div>
      </div>
      <div className="hero-bottom-line" />
    </section>

    <section className="shell home-instant">
      <div className="instant-label"><span className="eyebrow">PARKLY IN A MINUTE</span><span className="mono-font">01—03</span></div>
      <div className="instant-stats"><div><strong>Choose</strong><span>Places that fit your plan.</span></div><ArrowRight className="instant-arrow" /><div><strong>Reserve</strong><span>Your bay is held for you.</span></div><ArrowRight className="instant-arrow" /><div><strong>Arrive</strong><span>Follow your pass to the spot.</span></div></div>
    </section>

    <section className="featured-section"><div className="shell">
      <div className="section-heading"><div><span className="eyebrow">GOOD PLACES TO BEGIN</span><h2>Parking that’s<br /><em>already figured out.</em></h2></div>
        <Link href="/search" className="text-link" data-testid="link-view-all-spaces">Explore all spaces <ArrowRight size={17} /></Link></div>
      <LocationResults locations={featured} loading={locationsQuery.isLoading} error={locationsQuery.isError} retry={() => void locationsQuery.refetch()} />
      {!locationsQuery.isLoading && locations?.length ? <div className="featured-footnote"><span className="live-dot" />Live availability is refreshed as you search.</div> : null}
    </div></section>

    <section className="arrival-section"><div className="shell arrival-grid">
      <div className="arrival-art" aria-label="A simple guide to finding your reserved bay">
        <div className="route-map"><div className="map-grid" /><svg className="map-route" viewBox="0 0 430 330" role="img" aria-label="Route to parking bay"><path d="M58 273 C115 254 102 190 173 193 S217 132 280 152 317 83 374 56" /><circle cx="58" cy="273" r="10" /><circle cx="374" cy="56" r="12" /></svg>
          <div className="map-street street-a">M.G. ROAD</div><div className="map-street street-b">CHURCH STREET</div><div className="map-street street-c">CUBBON PARK</div>
          <div className="bay-ticket"><div><span className="eyebrow">YOUR BAY</span><strong>B2 · 014</strong></div><span className="ticket-check"><Check size={18} /></span></div>
        </div>
      </div>
      <div className="arrival-copy"><span className="eyebrow">THE LAST 100 METRES</span><h2>Know where<br />to <em>pull in.</em></h2><p>A reservation is more than a pin on a map. Parkly gives you a named bay, a clear arrival pass, and live entrance information to help you settle in quickly.</p>
        <Link href="/search" className="button button-dark" data-testid="link-find-my-space">Find your space <ArrowRight size={16} /></Link>
      </div>
    </div></section>
    <section className="closing-ribbon"><div className="shell ribbon-inner"><span className="eyebrow">LESS CIRCLING. MORE ARRIVING.</span><h2>Make room for<br /><em>what brought you here.</em></h2><Link href="/search" className="button button-lime" data-testid="link-start-search">Find parking <ArrowUpRight size={17} /></Link></div></section>
  </Layout>;
}

function SearchPage() {
  const params = new URLSearchParams(window.location.search);
  const [city, setCity] = useState(params.get('city') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [covered, setCovered] = useState(false);
  const [ev, setEv] = useState(false);
  const [accessible, setAccessible] = useState(false);
  const [view, setView] = useState<'list' | 'map'>(() => params.get('view') === 'map' ? 'map' : 'list');
  const [sort, setSort] = useState<'recommended' | 'price' | 'rating'>('recommended');
  const [locating, setLocating] = useState(false);
  const filters = useMemo(() => ({ city: city || undefined, q: query || undefined, covered: covered || undefined, evCharging: ev || undefined, accessible: accessible || undefined }), [city, query, covered, ev, accessible]);
  const result = useListParkingLocations(filters);
  const allLocations = useListParkingLocations();
  const sortedLocations = useMemo(() => {
    const items = [...(result.data ?? [])];
    if (sort === 'price') items.sort((a, b) => a.rate - b.rate);
    if (sort === 'rating') items.sort((a, b) => b.rating - a.rating);
    return items;
  }, [result.data, sort]);
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Location access is not available in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLocating(false);
      const candidates = (allLocations.data ?? []).filter(location => location.freeBays > 0);
      if (!candidates.length) {
        toast.error(allLocations.data?.length ? 'No open spaces are available in the listed locations right now.' : 'Parking locations have not loaded yet. Try again in a moment.');
        return;
      }
      const nearest = candidates.reduce((best, candidate) => {
        const radians = (degrees: number) => degrees * Math.PI / 180;
        const distance = (latitude: number, longitude: number) => {
          const dLat = radians(latitude - coords.latitude);
          const dLng = radians(longitude - coords.longitude);
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(coords.latitude)) * Math.cos(radians(latitude)) * Math.sin(dLng / 2) ** 2;
          return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };
        const bestDistance = distance(best.latitude, best.longitude);
        const candidateDistance = distance(candidate.latitude, candidate.longitude);
        return candidateDistance < bestDistance ? candidate : best;
      });
      setCity(nearest.city);
      setQuery('');
      setView('map');
    }, () => {
      setLocating(false);
      toast.error('We couldn’t read your location. Check browser permissions and try again.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  };
  return <Layout><div className="shell search-page page-enter">
    <div className="search-page-head"><div><span className="eyebrow">FIND YOUR PARKING</span><h1>Good to <em>go.</em></h1><p>Real spaces, clear rates, your time back.</p></div><div className="search-count">{result.data?.length ?? '—'}<span>spaces</span></div></div>
    <SearchBar compact initialCity={city} initialQuery={query} onSearch={(nextCity, nextQuery) => { setCity(nextCity); setQuery(nextQuery); }} />
    <div className="filter-row"><span className="filter-label"><SlidersHorizontal size={15} /> Refine:</span>
      <FilterToggle checked={covered} onChange={setCovered} label="Covered" testId="toggle-covered" />
      <FilterToggle checked={ev} onChange={setEv} label="EV charging" testId="toggle-ev" />
      <FilterToggle checked={accessible} onChange={setAccessible} label="Accessible" testId="toggle-accessible" />
      {(covered || ev || accessible) && <button className="clear-filter" onClick={() => { setCovered(false); setEv(false); setAccessible(false); }} data-testid="button-clear-filters">Clear</button>}
    </div>
    <div className="search-tools"><button className="button button-outline button-small" onClick={useMyLocation} disabled={locating || allLocations.isLoading} data-testid="button-use-my-location"><LocateFixed size={15} />{locating ? 'Finding nearby…' : 'Use my location'}</button><label className="sort-control"><span>Sort by</span><select value={sort} onChange={event => setSort(event.target.value as typeof sort)} data-testid="select-sort-parking"><option value="recommended">Recommended</option><option value="price">Price: low to high</option><option value="rating">Top rated</option></select></label><div className="view-switch" role="group" aria-label="Search results view"><button className={view === 'list' ? 'view-active' : ''} onClick={() => setView('list')} aria-pressed={view === 'list'} data-testid="button-list-view"><List size={15} /> List</button><button className={view === 'map' ? 'view-active' : ''} onClick={() => setView('map')} aria-pressed={view === 'map'} data-testid="button-map-view"><Map size={15} /> Map</button></div></div>
    <div className="search-results-heading"><h2>{city ? `Spaces in ${city}` : 'Spaces near your next stop'}</h2><span>{result.data?.length ?? 0} available locations</span></div>
    {view === 'list' ? <LocationResults locations={sortedLocations} loading={result.isLoading} error={result.isError} retry={() => void result.refetch()} /> : <MapResults locations={sortedLocations} loading={result.isLoading} error={result.isError} retry={() => void result.refetch()} />}
  </div></Layout>;
}
function FilterToggle({ checked, onChange, label, testId }: { checked: boolean; onChange: (value: boolean) => void; label: string; testId: string }) {
  return <button className={`filter-pill ${checked ? 'filter-active' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked} data-testid={testId}>
    {checked && <Check size={14} />}{label}
  </button>;
}

function ParkingDetailPage() {
  const { locationId = '' } = useParams<{ locationId: string }>();
  const locationQuery = useGetParkingLocation(locationId);
  const location = locationQuery.data;
  const { isSignedIn } = useUser();
  const [, setLocation] = useLocation();
  const [arrival, setArrival] = useState('');
  const [departure, setDeparture] = useState('');
  const [plate, setPlate] = useState('');
  const minDateTime = useMemo(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  }, []);
  const client = useQueryClient();
  const create = useCreateReservation();
  const reserve = () => {
    if (!isSignedIn) {
      setLocation(signInHref());
      return;
    }
    if (!location) return;
    if (!arrival || !departure || new Date(arrival).getTime() <= Date.now() || new Date(departure) <= new Date(arrival)) { toast.error('Choose an arrival after now and a later departure.'); return; }
    create.mutate({ data: { locationId: location.id, arrivalAt: new Date(arrival).toISOString(), departureAt: new Date(departure).toISOString(), ...(plate ? { vehiclePlate: plate } : {}) } }, {
      onSuccess: async reservation => {
        await Promise.all([client.invalidateQueries({ queryKey: getListReservationsQueryKey() }), client.invalidateQueries({ queryKey: getListParkingLocationsQueryKey() })]);
        setLocation(`/checkout/${reservation.id}`);
      },
      onError: () => toast.error('We couldn’t reserve that bay. Please try another time.'),
    });
  };
  if (locationQuery.isLoading) return <Layout><LoadingState label="Loading this parking location" /></Layout>;
  if (locationQuery.isError || !location) return <Layout><div className="shell detail-error"><ErrorState retry={() => void locationQuery.refetch()} /></div></Layout>;
  return <Layout><div className="shell detail-page page-enter">
    <Link href="/search" className="back-link" data-testid="link-back-search"><ArrowLeft size={16} /> All parking</Link>
    <div className="detail-layout">
      <div className="detail-main">
        <div className="detail-hero">
          {location.imageUrl ? <img src={location.imageUrl} alt={`${location.name}`} data-testid={`img-location-${location.id}`} /> : <div className="image-fallback detail-fallback"><Building2 size={44} /><span>{location.city}</span></div>}
          <div className="detail-photo-caption"><span className="live-dot" /> Live availability</div>
        </div>
        <div className="detail-title-row"><div><span className="eyebrow">{location.city}, {location.country}</span><h1>{location.name}</h1><p className="detail-address"><MapPin size={16} />{location.address}</p></div>
          <div className="rating-large"><Star size={16} fill="currentColor" /> {location.rating.toFixed(1)}</div></div>
        <p className="detail-description">{location.description || 'A convenient, well-connected place to leave your car while you get on with your day.'}</p>
        <div className="detail-metrics"><div><strong>{location.freeBays}</strong><span>spaces free now</span></div><div><strong>{location.totalBays}</strong><span>total bays</span></div><div><strong>{location.driveMinutes} min</strong><span>from the centre</span></div></div>
        <section className="amenities-section"><span className="eyebrow">GOOD TO KNOW</span><h2>Space for your kind of day.</h2>
          <div className="amenity-list">{location.amenities?.length ? location.amenities.map((amenity, i) => <span className="amenity-tag" key={`${amenity}-${i}`}><CheckCircle2 size={15} />{amenity}</span>) : <span className="amenity-tag"><BadgeCheck size={15} />Verified parking location</span>}</div>
        </section>
        <div className="location-facts"><div><Navigation size={17} /><span>{location.walkMinutes} min walk to nearby destinations</span></div><div><Clock3 size={17} /><span>Drive time estimate: {location.driveMinutes} min</span></div><div><ShieldCheck size={17} /><span>{location.estimateOnly ? 'Rates may be estimates' : 'Rate shown before you reserve'}</span></div></div>
      </div>
      <aside className="booking-card">
        <div className="booking-price"><strong>{money(location.rate, location.currency)}</strong><span>per hour</span></div>
        <div className="booking-live"><span className="live-dot" /><b>{location.freeBays} bays available now</b></div>
        <div className="booking-fields"><label>Arrival<input type="datetime-local" min={minDateTime} value={arrival} onChange={e => setArrival(e.target.value)} data-testid="input-arrival-time" /></label>
          <label>Departure<input type="datetime-local" min={arrival || minDateTime} value={departure} onChange={e => setDeparture(e.target.value)} data-testid="input-departure-time" /></label>
          <label>Vehicle plate <span className="optional">Optional</span><input value={plate} onChange={e => setPlate(e.target.value)} placeholder="e.g. KA 03 AB 1234" data-testid="input-vehicle-plate" /></label>
        </div>
        <button className="button button-lime booking-button" disabled={create.isPending || location.freeBays <= 0} onClick={reserve} data-testid="button-reserve-space">
          {create.isPending ? 'Holding your bay…' : location.freeBays <= 0 ? 'No spaces available' : !isSignedIn ? <>Sign in to reserve <ArrowRight size={17} /></> : <>Reserve this space <ArrowRight size={17} /></>}
        </button>
         <p className="booking-note"><ShieldCheck size={14} /> Preview mode: no payment is collected.</p>
        {create.isError && <p role="alert" className="inline-error" data-testid="status-reservation-error">Reservation could not be completed. Please try again.</p>}
      </aside>
    </div>
  </div></Layout>;
}

function CheckoutPage() {
  const { reservationId = '' } = useParams<{ reservationId: string }>();
  const query = useListReservations();
  const pass = query.data?.find(item => item.id === reservationId);
  if (query.isLoading) return <Layout><LoadingState label="Preparing your parking pass" /></Layout>;
  if (query.isError) return <Layout><div className="shell checkout-wrap"><ErrorState retry={() => void query.refetch()} /></div></Layout>;
  if (!pass) return <Layout><div className="shell checkout-wrap"><EmptyState title="Pass not found" note="This reservation may have expired, or it belongs to another account." /><Link href="/dashboard" className="button button-dark" data-testid="link-open-dashboard">Go to my passes</Link></div></Layout>;
  return <Layout><PassConfirmation reservation={pass} /></Layout>;
}
function PassConfirmation({ reservation }: { reservation: Reservation }) {
  return <div className="shell checkout-wrap page-enter">
    <div className="success-emblem"><Check size={26} /></div><span className="eyebrow">YOU’RE ALL SET</span>
    <h1>Your space is <em>waiting.</em></h1><p className="checkout-subtitle">Reservation confirmed. Here’s everything you need for a smooth arrival.</p>
    <article className="pass-card" data-testid={`card-pass-${reservation.id}`}>
      <div className="pass-head"><div><span className="eyebrow">PARKLY ARRIVAL PASS</span><h2>{reservation.locationName}</h2><p>{reservation.address}, {reservation.city}</p></div><span className="pass-status"><CheckCircle2 size={15} /> Confirmed</span></div>
      <div className="pass-dates"><div><span>ARRIVE</span><strong>{dateTime(reservation.arrivalAt)}</strong></div><ArrowRight size={18} /><div><span>LEAVE BY</span><strong>{dateTime(reservation.departureAt)}</strong></div></div>
      <div className="pass-code-area"><div><span className="eyebrow">YOUR BAY</span><strong className="bay-code">{reservation.bayCode}</strong></div><div className="pass-code"><span>ENTRY CODE</span><strong>{reservation.passCode}</strong></div></div>
       <div className="pass-foot"><span><CreditCard size={15} /> {money(reservation.amount, reservation.currency)} reservation total</span><span>Preview only · no payment was collected</span></div>
    </article>
    <div className="checkout-actions"><Link href="/dashboard" className="button button-dark" data-testid="link-view-pass-dashboard"><TicketCheck size={17} /> View all passes</Link><Link href={`/display/${reservation.locationId}`} className="button button-outline" data-testid="link-view-entrance-board">See entrance board <ExternalLink size={15} /></Link></div>
  </div>;
}

function DashboardPage() {
  const summary = useGetDashboardSummary();
  const reservations = useListReservations();
  const cancelMutation = useCancelReservation();
  const client = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const cancel = (reservationId: string) => cancelMutation.mutate({ reservationId }, {
    onSuccess: async () => {
      setConfirmId(null);
      await Promise.all([client.invalidateQueries({ queryKey: getListReservationsQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }), client.invalidateQueries({ queryKey: getListParkingLocationsQueryKey() })]);
      toast.success('Reservation cancelled. The bay is available again.');
    },
    onError: () => toast.error('We couldn’t cancel this reservation. Try again.'),
  });
  if (summary.isLoading || reservations.isLoading) return <Layout><LoadingState label="Gathering your parking plans" /></Layout>;
  if (summary.isError || reservations.isError) return <Layout><div className="shell dashboard-shell"><ErrorState retry={() => { void summary.refetch(); void reservations.refetch(); }} /></div></Layout>;
  const items = reservations.data ?? [];
  const upcoming = items.filter(r => r.status === 'upcoming' || r.status === 'active');
  return <Layout><div className="shell dashboard-shell page-enter">
    <div className="dashboard-welcome"><div><span className="eyebrow">YOUR PARKLY</span><h1>Good to see <em>you.</em></h1><p>Your plans, passes, and parking — all in one place.</p></div><Link href="/search" className="button button-lime" data-testid="link-dashboard-find-parking"><Search size={17} /> Find parking</Link></div>
    <section className="summary-strip" aria-label="Parking summary">
      <SummaryStat label="Upcoming" value={summary.data?.upcomingCount ?? 0} icon={<CalendarDays size={18} />} testId="summary-upcoming" />
      <SummaryStat label="Active now" value={summary.data?.activeCount ?? 0} icon={<CarFront size={19} />} testId="summary-active" />
      <SummaryStat label="Completed" value={summary.data?.completedCount ?? 0} icon={<CheckCircle2 size={18} />} testId="summary-completed" />
      <SummaryStat label="Saved with Parkly" value={money(summary.data?.savings ?? 0)} icon={<Sparkles size={18} />} testId="summary-savings" />
    </section>
    {summary.data?.nextReservation && <div className="next-trip-banner"><span className="next-trip-icon"><Navigation size={19} /></span><div><span className="eyebrow">UP NEXT</span><strong>{summary.data.nextReservation.locationName}</strong><span>{dateTime(summary.data.nextReservation.arrivalAt)}</span></div>
      <Link href={`/checkout/${summary.data.nextReservation.id}`} className="text-link" data-testid="link-next-reservation">Open pass <ArrowRight size={16} /></Link></div>}
    <div className="reservations-heading"><div><span className="eyebrow">YOUR PARKING HISTORY</span><h2>Reservations</h2></div><span>{items.length} total</span></div>
    {items.length === 0 ? <EmptyState title="Nothing on the calendar yet" note="When you reserve a space, your pass will be right here. Find a spot for your next stop." /> :
      <div className="reservation-list">{items.map(item => <ReservationRow key={item.id} item={item} confirming={confirmId === item.id} pending={cancelMutation.isPending} onConfirm={() => cancel(item.id)} onCancel={() => setConfirmId(confirmId === item.id ? null : item.id)} />)}</div>}
  </div></Layout>;
}
function SummaryStat({ label, value, icon, testId }: { label: string; value: string | number; icon: ReactNode; testId: string }) {
  return <div className="summary-stat" data-testid={testId}><span className="summary-icon">{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div>;
}
function ReservationRow({ item, confirming, pending, onConfirm, onCancel }: { item: Reservation; confirming: boolean; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const statusClass = item.status === 'active' ? 'status-active' : item.status === 'cancelled' ? 'status-cancelled' : item.status === 'completed' ? 'status-completed' : 'status-upcoming';
  return <article className="reservation-row" data-testid={`row-reservation-${item.id}`}>
    <div className="reservation-date"><strong>{new Date(item.arrivalAt).getDate()}</strong><span>{new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(item.arrivalAt))}</span></div>
    <div className="reservation-info"><span className={`reservation-status ${statusClass}`} data-testid={`status-reservation-${item.id}`}>{item.status.replace('_', ' ')}</span><h3>{item.locationName}</h3><p>{item.address}, {item.city}</p><span className="reservation-time">{dateTime(item.arrivalAt)} <span>→</span> {dateOnly(item.departureAt)}</span></div>
    <div className="reservation-side"><strong>{money(item.amount, item.currency)}</strong><span>Bay {item.bayCode}</span>
      <div className="reservation-actions">{item.status === 'upcoming' && (confirming ?
        <><button className="button button-coral button-small" disabled={pending} onClick={onConfirm} data-testid={`button-confirm-cancel-${item.id}`}>{pending ? 'Cancelling…' : 'Confirm cancel'}</button><button className="cancel-link" onClick={onCancel} data-testid={`button-keep-reservation-${item.id}`}>Keep</button></> :
        <button className="cancel-link" onClick={onCancel} data-testid={`button-cancel-reservation-${item.id}`}>Cancel</button>)}
        <Link href={`/checkout/${item.id}`} className="pass-open" data-testid={`link-open-reservation-${item.id}`}>Pass <ChevronRight size={14} /></Link></div>
    </div>
  </article>;
}

function OwnerPage() {
  const query = useGetOwnerLocations();
  const client = useQueryClient();
  const [selected, setSelected] = useState('');
  const [bulkStatus, setBulkStatus] = useState<ParkingBayStatus>('free');
  const locationId = selected || query.data?.[0]?.id || '';
  useLiveBayUpdates(locationId);
  const board = useGetEntranceBoard(locationId, { query: { enabled: !!locationId, queryKey: getGetEntranceBoardQueryKey(locationId) } });
  const updateStatus = useUpdateBayStatus();
  const changeBay = (bay: ParkingBay, status: ParkingBayStatus) => updateStatus.mutate({ locationId, bayId: bay.id, data: { status } }, {
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: getGetEntranceBoardQueryKey(locationId) }), client.invalidateQueries({ queryKey: getGetOwnerLocationsQueryKey() }), client.invalidateQueries({ queryKey: getListParkingLocationsQueryKey() })]);
      toast.success(`Bay ${bay.code} updated.`);
    },
    onError: () => toast.error(`Bay ${bay.code} could not be updated.`),
  });
  const applyBulkStatus = async () => {
    const targetBays = (board.data?.bays ?? []).filter(bay => bay.status !== 'reserved');
    if (!targetBays.length) {
      toast.info('There are no non-reserved bays to update.');
      return;
    }
    const results = await Promise.allSettled(targetBays.map(bay =>
      updateStatus.mutateAsync({ locationId, bayId: bay.id, data: { status: bulkStatus } }),
    ));
    await Promise.all([
      client.invalidateQueries({ queryKey: getGetEntranceBoardQueryKey(locationId) }),
      client.invalidateQueries({ queryKey: getGetOwnerLocationsQueryKey() }),
      client.invalidateQueries({ queryKey: getListParkingLocationsQueryKey() }),
    ]);
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed) toast.error(`${failed} bay${failed === 1 ? '' : 's'} could not be updated.`);
    else toast.success(`${targetBays.length} non-reserved bays updated.`);
  };
  if (query.isLoading) return <Layout><LoadingState label="Loading your locations" /></Layout>;
  if (query.isError) return <Layout><div className="shell dashboard-shell"><ErrorState retry={() => void query.refetch()} /></div></Layout>;
  const locations = query.data ?? [];
  return <Layout><div className="shell owner-shell page-enter">
    <div className="dashboard-welcome"><div><span className="eyebrow">PARKLY OWNER STUDIO</span><h1>Your spaces, <em>in motion.</em></h1><p>See availability as drivers see it, and keep each bay up to date.</p></div><div className="owner-live-label"><span className="live-dot" /> LIVE OPERATIONS</div></div>
    {!locations.length ? <EmptyState title="No managed locations yet" note="Locations assigned to your owner account will appear here, along with live bay controls." /> : <>
      <div className="owner-location-switcher"><label htmlFor="owner-location">LOCATION</label><div className="select-wrap"><select id="owner-location" value={locationId} onChange={e => setSelected(e.target.value)} data-testid="select-owner-location">{locations.map(l => <option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}</select><ChevronDown size={17} /></div>
        {locations.map(location => <div className="owner-location-mini" key={location.id}><span>{location.city}</span><strong>{location.freeBays}<small>/{location.totalBays} free</small></strong></div>)}
      </div>
      {board.isLoading ? <div className="owner-board-loading"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" /></div> : board.isError ? <ErrorState retry={() => void board.refetch()} /> : board.data && <section className="owner-board">
        <div className="board-title"><div><span className="eyebrow">LIVE BAY CONTROL</span><h2>{board.data.locationName}</h2><p>Update bay status to keep arrivals running smoothly.</p></div><span className="board-updated"><span className="live-dot" />Updated {new Date(board.data.updatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span></div>
        <div className="bulk-bay-controls"><label htmlFor="bulk-bay-status">Set every non-reserved bay to</label><div className="bulk-bay-actions"><select id="bulk-bay-status" value={bulkStatus} onChange={event => setBulkStatus(event.target.value as ParkingBayStatus)} data-testid="select-bulk-bay-status"><option value="free">Free</option><option value="occupied">Occupied</option><option value="out_of_service">Out of service</option></select><button className="button button-dark button-small" onClick={() => void applyBulkStatus()} disabled={updateStatus.isPending} data-testid="button-bulk-bay-status">{updateStatus.isPending ? 'Updating…' : 'Apply to non-reserved bays'}</button></div><span>Reserved bays are left unchanged.</span></div>
        <BayControls bays={board.data.bays} pending={updateStatus.isPending} onStatus={changeBay} />
        <div className="bay-legend"><span><i className="legend-free" />Free</span><span><i className="legend-reserved" />Reserved</span><span><i className="legend-occupied" />Occupied</span><span><i className="legend-out" />Out of service</span></div>
      </section>}
    </>}
  </div></Layout>;
}
function BayControls({ bays, pending, onStatus }: { bays: ParkingBay[]; pending: boolean; onStatus: (bay: ParkingBay, status: ParkingBayStatus) => void }) {
  if (!bays.length) return <EmptyState title="No bays reported" note="This location has no bay inventory available yet." />;
  return <div className="bay-grid">{bays.map(bay => <div className={`bay-card bay-${bay.status}`} key={bay.id} data-testid={`card-bay-${bay.id}`}>
    <div className="bay-card-top"><span>{bay.level}</span><span className="bay-type">{bay.type}</span></div><strong>{bay.code}</strong>
    <span className="bay-state" data-testid={`status-bay-${bay.id}`}>{bay.status.replace('_', ' ')}</span>
    <label htmlFor={`bay-status-${bay.id}`}>Change status</label><select id={`bay-status-${bay.id}`} value={bay.status} disabled={pending} onChange={e => onStatus(bay, e.target.value as ParkingBayStatus)} data-testid={`select-bay-status-${bay.id}`}>
      <option value="free">Free</option><option value="reserved">Reserved</option><option value="occupied">Occupied</option><option value="out_of_service">Out of service</option>
    </select>
  </div>)}</div>;
}

function AdminPage() {
  const query = useGetAdminSummary();
  if (query.isLoading) return <Layout><LoadingState label="Gathering platform activity" /></Layout>;
  if (query.isError || !query.data) return <Layout><div className="shell dashboard-shell"><ErrorState retry={() => void query.refetch()} /></div></Layout>;
  const data = query.data;
  const cities = [...data.cities].sort((a, b) => b.bookings - a.bookings);
  const max = Math.max(...cities.map(c => c.bookings), 1);
  return <Layout><div className="shell admin-shell page-enter">
    <div className="dashboard-welcome"><div><span className="eyebrow">PARKLY PLATFORM</span><h1>Moving at <em>a glance.</em></h1><p>A live view of reservations, earnings, and the cities coming along for the ride.</p></div><div className="owner-live-label"><span className="live-dot" /> PLATFORM SUMMARY</div></div>
    <div className="admin-metrics">
      <AdminMetric label="Bookings" value={data.bookings.toLocaleString('en-IN')} icon={<TicketCheck size={19} />} note="All-time reservations" />
      <AdminMetric label="Revenue" value={money(data.revenue)} icon={<CreditCard size={19} />} note="Across the network" />
      <AdminMetric label="Occupancy" value={`${data.occupancy}%`} icon={<Gauge size={19} />} note="Current platform average" />
      <AdminMetric label="Locations" value={data.locations.toLocaleString('en-IN')} icon={<Building2 size={19} />} note={`${data.cities.length} active cities`} />
    </div>
    <section className="city-performance"><div className="board-title"><div><span className="eyebrow">CITY BY CITY</span><h2>Where Parkly moves.</h2></div><span className="city-total">{data.cities.length} cities</span></div>
      {cities.length ? <div className="city-chart">{cities.map((city, i) => <div className="city-bar-row" key={city.city} data-testid={`row-city-${i}`}>
        <span className="city-rank mono-font">{String(i + 1).padStart(2, '0')}</span><strong>{city.city}</strong><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(5, city.bookings / max * 100)}%` }} /></div><span className="city-bookings">{city.bookings.toLocaleString('en-IN')} bookings</span></div>)}</div> : <EmptyState title="No city activity yet" note="City booking performance will appear as reservations are made." />}
    </section>
    <div className="admin-footnote"><ShieldCheck size={16} /> Summary values are served by Parkly’s platform API.</div>
  </div></Layout>;
}
function AdminMetric({ label, value, icon, note }: { label: string; value: string; icon: ReactNode; note: string }) {
  return <div className="admin-metric"><span className="admin-metric-icon">{icon}</span><span className="eyebrow">{label}</span><strong data-testid={`metric-${label.toLowerCase()}`}>{value}</strong><span>{note}</span></div>;
}

function EntranceBoardPage() {
  const { locationId = '' } = useParams<{ locationId: string }>();
  useLiveBayUpdates(locationId);
  const query = useGetEntranceBoard(locationId, { query: { enabled: !!locationId, queryKey: getGetEntranceBoardQueryKey(locationId), refetchInterval: 30_000 } });
  if (query.isLoading) return <div className="entrance-page"><div className="entrance-shell"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" /></div></div>;
  if (query.isError || !query.data) return <div className="entrance-page"><div className="entrance-shell"><ErrorState retry={() => void query.refetch()} /></div></div>;
  const board = query.data;
  const availability = board.totalBays ? Math.round(board.freeBays / board.totalBays * 100) : 0;
  return <div className="entrance-page" data-testid="page-entrance-board"><div className="entrance-shell page-enter">
    <header className="entrance-header"><Brand inverse /><span className="public-live"><span className="live-dot" /> LIVE ENTRANCE BOARD</span></header>
    <section className="entrance-overview"><span className="eyebrow">WELCOME TO</span><h1>{board.locationName}</h1><p><MapPin size={15} /> Parkly monitored parking</p>
      <div className="entrance-availability"><div><span className="eyebrow">SPACES AVAILABLE</span><strong><b>{board.freeBays}</b><span> / {board.totalBays}</span></strong></div>
        <div className="availability-meter"><div style={{ width: `${availability}%` }} /></div><span className="entrance-updated"><span className="live-dot" />Updated {new Date(board.updatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span></div>
    </section>
    <section className="entrance-bays"><div className="entrance-section-heading"><div><span className="eyebrow">BAY DIRECTORY</span><h2>Find your space.</h2></div><button className="refresh-board" onClick={() => void query.refetch()} data-testid="button-refresh-board"><Activity size={15} /> Refresh</button></div>
      {board.bays.length ? <div className="public-bay-grid">{board.bays.map(bay => <PublicBay key={bay.id} bay={bay} />)}</div> : <EmptyState title="Bay details are on the way" note="Ask the parking attendant to guide you." />}
    </section>
    <footer className="entrance-footer"><span><ParkingCircle size={18} /> parkly<span>.</span></span><span>Clear arrivals start here.</span></footer>
  </div></div>;
}
function PublicBay({ bay }: { bay: ParkingBay }) {
  const displayStatus = bay.status === 'free' ? 'AVAILABLE' : bay.status === 'reserved' ? 'RESERVED' : bay.status === 'occupied' ? 'OCCUPIED' : 'UNAVAILABLE';
  return <article className={`public-bay public-${bay.status}`} data-testid={`public-bay-${bay.id}`}>
    <div className="public-bay-head"><span>{bay.level}</span><span className="public-bay-type">{bay.type}</span></div><strong>{bay.code}</strong>
    <span className="public-status" data-testid={`public-status-${bay.id}`}><i />{displayStatus}</span>
  </article>;
}

function PhoneSignInPage() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [formError, setFormError] = useState('');
  const startVerification = useStartPhoneVerification();
  const verifyCode = useVerifyPhoneCode();
  const { signIn, isLoaded, setActive } = useSignIn();
  const [, setLocation] = useLocation();
  const normalizedPhone = phone.replace(/[^\d+]/g, '');
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  const requestCode = () => {
    setFormError('');
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      setFormError('Enter a phone number with its country code, such as +91 98765 43210.');
      return;
    }
    startVerification.mutate({ data: { phoneNumber: normalizedPhone } }, {
      onSuccess: result => {
        if (result.accepted) { setSent(true); setCooldown(60); }
        else setFormError('We couldn’t send a code to that number. Check it and try again.');
      },
      onError: () => setFormError('We couldn’t send a code just now. Please try again.'),
    });
  };
  const start = (event: FormEvent) => {
    event.preventDefault();
    requestCode();
  };
  const verify = (event: FormEvent) => {
    event.preventDefault(); setFormError('');
    verifyCode.mutate({ data: { phoneNumber: normalizedPhone, code } }, {
      onSuccess: async ticket => {
        try {
          if (!isLoaded || !signIn || !setActive) { setFormError('Sign-in is still loading. Try again in a moment.'); return; }
          const result = await signIn.create({ strategy: 'ticket', ticket: ticket.ticket });
           if (result.createdSessionId) {
             await setActive({ session: result.createdSessionId });
             setLocation(stripBase(safeAuthRedirect()));
           }
          else setFormError('Your code was accepted, but this session could not be opened.');
        } catch { setFormError('That code may have expired. Request a new one and try again.'); }
      },
      onError: () => setFormError('That code doesn’t match. Check the message and try again.'),
    });
  };
  return <Layout noFooter><section className="auth-page"><div className="auth-card">
    <Link href="/" className="auth-back" data-testid="link-auth-home"><ArrowLeft size={16} /> Back to Parkly</Link>
    <span className="eyebrow">A QUICKER WAY IN</span><h1>Sign in with<br /><em>your phone.</em></h1>
    <p className="auth-copy">{sent ? `We sent a one-time code to ${phone}.` : 'We’ll text you a one-time code. No password to remember.'}</p>
    {!sent ? <form onSubmit={start} className="phone-form"><label>Phone number<input type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" minLength={8} maxLength={20} required data-testid="input-phone-number" /></label>
      <button className="button button-lime auth-submit" disabled={startVerification.isPending} data-testid="button-send-otp">{startVerification.isPending ? 'Sending code…' : <>Send one-time code <ArrowRight size={17} /></>}</button></form> :
      <form onSubmit={verify} className="phone-form"><label>Verification code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Enter the 6-digit code" minLength={6} maxLength={6} pattern="[0-9]{6}" required data-testid="input-phone-otp" /></label>
        <button className="button button-lime auth-submit" disabled={verifyCode.isPending} data-testid="button-verify-otp">{verifyCode.isPending ? 'Checking code…' : <>Verify and continue <ArrowRight size={17} /></>}</button>
        <div className="phone-secondary-actions"><button type="button" className="cancel-link resend-code" disabled={cooldown > 0 || startVerification.isPending} onClick={() => { setCode(''); requestCode(); }} data-testid="button-resend-code">{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</button><button type="button" className="cancel-link resend-code" onClick={() => { setSent(false); setCode(''); setCooldown(0); }} data-testid="button-change-phone">Use a different number</button></div></form>}
    {formError && <p className="inline-error" role="alert" data-testid="status-phone-error">{formError}</p>}
     <div className="auth-divider"><span>or use your account</span></div><Link className="button button-outline auth-account-button" href={`/sign-in?redirect_url=${encodeURIComponent(safeAuthRedirect())}`} data-testid="link-normal-sign-in">Continue with Google or email <ChevronRight size={16} /></Link>
    <p className="auth-legal">By continuing, you agree to our <Link href="/terms" data-testid="link-phone-terms">Terms</Link> and <Link href="/privacy" data-testid="link-phone-privacy">Privacy Policy</Link>.</p>
  </div><div className="auth-side-note"><span className="auth-note-mark"><KeyRound size={20} /></span><span>One small step.<br /><strong>A much smoother arrival.</strong></span></div></section></Layout>;
}
function ClerkSignInPage() {
  const redirectUrl = safeAuthRedirect();
  return <div className="clerk-page"><div className="clerk-context"><Brand /><span className="eyebrow">PARKING, WITHOUT THE GUESSWORK</span><h1>Know where<br />you’re going.</h1><p>Sign in to keep your passes, plans, and parking details close.</p><Link className="phone-auth-link" href={`/sign-in/phone?redirect_url=${encodeURIComponent(redirectUrl)}`} data-testid="link-phone-sign-in"><Phone size={16} /> Use a phone number instead <ArrowRight size={15} /></Link>
    {import.meta.env.DEV && <div className="demo-access"><span>PREVIEW ACCOUNTS</span><p>Driver · driver@parklydemo.com<br />Owner · owner@parklydemo.com<br />Admin · admin@parklydemo.com</p><small>Password for all: <code>ParklyDemo2026!</code></small></div>}
  </div>
    <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`} forceRedirectUrl={redirectUrl} />
  </div>;
}
function ClerkSignUpPage() {
  const redirectUrl = safeAuthRedirect();
  return <div className="clerk-page signup-clerk"><div className="clerk-context"><Brand /><span className="eyebrow">MORE TIME FOR THE REASON YOU’RE GOING</span><h1>Your next<br />stop, sorted.</h1><p>Create your Parkly account and make parking part of the plan.</p><Link className="phone-auth-link" href={`/sign-in/phone?redirect_url=${encodeURIComponent(redirectUrl)}`} data-testid="link-phone-sign-up">Already have an account? Sign in by phone <ArrowRight size={15} /></Link></div>
    <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`} forceRedirectUrl={redirectUrl} />
  </div>;
}

const infoCopy: Record<string, { title: string; kicker: string; paragraphs: string[] }> = {
  help: { title: 'A little help, right here.', kicker: 'PARKLY SUPPORT', paragraphs: [
    'Parkly helps you find available parking, reserve a bay, and get the details you need before arrival.',
    'To reserve: search by city or destination, open a location, choose an arrival and departure time, then reserve. Your arrival pass includes the bay code and entry code.',
    'Need to change plans? Open My passes from the navigation and cancel an upcoming reservation. For a live bay-status question, use the entrance board or contact the location team.',
  ] },
  privacy: { title: 'Your journey is yours.', kicker: 'PRIVACY', paragraphs: [
    'Parkly uses the information needed to manage sign-in, parking searches, reservations, and arrival passes.',
    'Location and vehicle details are only requested when needed to help you plan a parking visit. Do not include sensitive information in a vehicle plate field.',
    'This page is a product information screen. Contact Parkly support through your account for questions about your information or account access.',
  ] },
  terms: { title: 'Clear terms. Clear arrival.', kicker: 'TERMS OF SERVICE', paragraphs: [
    'Parkly helps drivers discover and reserve parking spaces provided by participating locations. Availability and location details are served by the Parkly platform.',
    'A reservation is subject to the time window, rate, and status shown in your arrival pass. Please follow location signage and staff instructions when you arrive.',
    'If your plans change, cancel an eligible upcoming reservation from My passes. Estimate-only rates are marked clearly on the location page.',
  ] },
};
function InformationPage({ page }: { page: 'help' | 'privacy' | 'terms' }) {
  const copy = infoCopy[page];
  return <Layout><section className="shell info-page page-enter"><Link href="/" className="back-link" data-testid="link-info-home"><ArrowLeft size={16} /> Parkly</Link>
    <span className="eyebrow">{copy.kicker}</span><h1>{copy.title}</h1><div className="info-copy">{copy.paragraphs.map((paragraph, index) => <p key={index} data-testid={`text-${page}-${index}`}>{paragraph}</p>)}</div>
    {page === 'help' && <div className="help-contact"><CircleHelp size={19} /><div><strong>Need more help?</strong><span>Sign in to find support alongside your passes.</span></div><Link href="/sign-in" data-testid="link-help-sign-in">Sign in <ArrowRight size={15} /></Link></div>}
  </section></Layout>;
}

function ProtectedCheckoutPage() { return <AccountGate><CheckoutPage /></AccountGate>; }
function ProtectedDashboardPage() { return <AccountGate><DashboardPage /></AccountGate>; }
function ProtectedOwnerPage() { return <AccountGate role="owner"><OwnerPage /></AccountGate>; }
function ProtectedAdminPage() { return <AccountGate role="admin"><AdminPage /></AccountGate>; }

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to get back to good plans.' } }, signUp: { start: { title: 'Make room for your plans', subtitle: 'Create your Parkly account.' } } }}
    routerPush={to => setLocation(stripBase(to))}
    routerReplace={to => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryCache />
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/parking/:locationId" component={ParkingDetailPage} />
        <Route path="/checkout/:reservationId" component={ProtectedCheckoutPage} />
        <Route path="/dashboard" component={ProtectedDashboardPage} />
        <Route path="/owner" component={ProtectedOwnerPage} />
        <Route path="/admin" component={ProtectedAdminPage} />
        <Route path="/display/:locationId" component={EntranceBoardPage} />
        <Route path="/sign-in/phone" component={PhoneSignInPage} />
        <Route path="/sign-in/*?" component={ClerkSignInPage} />
        <Route path="/sign-up/*?" component={ClerkSignUpPage} />
        <Route path="/help"><InformationPage page="help" /></Route>
        <Route path="/privacy"><InformationPage page="privacy" /></Route>
        <Route path="/terms"><InformationPage page="terms" /></Route>
        <Route component={NotFound} />
      </Switch>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  </ClerkProvider>;
}

function ClerkQueryCache() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const priorUser = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (priorUser.current !== undefined && priorUser.current !== userId) client.clear();
    priorUser.current = userId;
  }), [addListener, client]);
  return null;
}

function App() {
  return <WouterRouter base={basePath}><ClerkRoutes /></WouterRouter>;
}
export default App;
