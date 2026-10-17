import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PawPrint, Heart, Camera, Search, MapPin, ShieldCheck, LogOut, Plus, Menu, ArrowRight, Upload, Dog, AlertCircle } from 'lucide-react';
import './style.css';

const API = 'https://petbridge-ai-backend.onrender.com';
async function request(path, opts = {}) {
  const token = localStorage.getItem('pawtoken');
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...opts.headers,
    },
  });
  const json = await res.json().catch(() => ({ detail: 'Request failed' }));
  if (!res.ok) throw Error(typeof json.detail === 'string' ? json.detail : 'Request failed');
  return json;
}
const Img = ({ src, ...props }) => <img src={src?.startsWith('/uploads/') ? API + src : src || 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=900'} {...props} />;

function App() {
  const [page, setPage] = useState('home');
  const [pets, setPets] = useState([]);
  const [lost, setLost] = useState([]);
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('pawuser') || 'null'); } catch { return null; } });
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState('');
  const [city, setCity] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState([]);
  const [myPets, setMyPets] = useState([]);
  const [pending, setPending] = useState([]);
  const [mobile, setMobile] = useState(false);

  const toast = t => { setMsg(t); setTimeout(() => setMsg(''), 5000); };
  const load = () => {
    request('/api/pets').then(setPets).catch(() => {});
    request('/api/lost').then(setLost).catch(() => {});
  };
  useEffect(load, []);
  const navigate = p => {
    setPage(p); setMobile(false); window.scrollTo(0, 0);
    if (p === 'dashboard' && user) {
      request('/api/applications').then(setApps).catch(e => toast(e.message));
      request('/api/my/pets').then(setMyPets).catch(() => {});
      request('/api/admin/pending').then(setPending).catch(() => {});
    }
  };
  const logout = () => {
    localStorage.removeItem('pawtoken'); localStorage.removeItem('pawuser');
    setUser(null); navigate('home');
  };
  const auth = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (modal === 'register') {
        await request('/api/register', { method: 'POST', body: JSON.stringify(f) });
        toast('Account created. Please log in.'); setModal('login');
      } else {
        const d = await request('/api/login', { method: 'POST', body: JSON.stringify(f) });
        localStorage.setItem('pawtoken', d.token);
        localStorage.setItem('pawuser', JSON.stringify(d.user));
        setUser(d.user); setModal(null); toast('Welcome back, ' + d.user.name);
      }
    } catch (err) { toast(err.message); }
  };
  const submitPet = async e => {
    e.preventDefault(); setBusy(true);
    const form = e.currentTarget;
    try {
      const f = Object.fromEntries(new FormData(form));
      if (f.photo?.size) {
        const fd = new FormData(); fd.append('file', f.photo);
        f.image = (await request('/api/upload', { method: 'POST', body: fd })).url;
      }
      delete f.photo;
      await request('/api/pets', { method: 'POST', body: JSON.stringify(f) });
      toast('Pet submitted for verification. It will not appear publicly until approved.');
      form.reset(); load(); navigate('dashboard');
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };
  const submitLost = async e => {
    e.preventDefault(); setBusy(true);
    const form = e.currentTarget;
    try {
      const f = Object.fromEntries(new FormData(form));
      if (f.photo?.size) {
        const fd = new FormData(); fd.append('file', f.photo);
        f.image = (await request('/api/upload', { method: 'POST', body: fd })).url;
      }
      delete f.photo;
      await request('/api/lost', { method: 'POST', body: JSON.stringify(f) });
      toast('Report published'); form.reset(); load(); navigate('lost');
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };
  const detect = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Please select a photo under 5 MB.'); e.target.value = ''; return; }
    setBusy(true); setResult(null);
    let objectUrl;
    try {
      // Runs on the visitor's device: no paid inference API or HF_TOKEN needed.
      const mobilenet = await import('@tensorflow-models/mobilenet');
      await import('@tensorflow/tfjs');
      if (!window.pawconnectMobileNet) window.pawconnectMobileNet = await mobilenet.load({version: 2, alpha: 0.5});
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      const predictions = await window.pawconnectMobileNet.classify(img, 5);
      setResult({
        available: true,
        predictions: predictions.map(p => ({label: p.className, score: p.probability})),
        warning: 'Free on-device ImageNet classification. Some dog breeds can be suggested; cat breeds and age are not reliably identified. Results are not verified.'
      });
    } catch (err) {
      console.error('On-device AI scanner failed:', err);
      setResult({available: false, message: 'Could not load the free AI model. Check internet connection and try again.'});
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBusy(false); e.target.value = '';
    }
  };
  const apply = async p => {
    if (!user) { setModal('login'); return; }
    const message = prompt('Tell the NGO/owner why you would be a good adopter (minimum 10 characters):');
    if (!message) return;
    try { await request('/api/applications', { method: 'POST', body: JSON.stringify({ pet_id: p.id, message }) }); toast('Application submitted successfully'); }
    catch (err) { toast(err.message); }
  };
  const status = async (id, newStatus, type) => {
    try {
      await request(type === 'pet' ? `/api/pets/${id}/status` : `/api/applications/${id}/status`, { method: 'POST', body: JSON.stringify({ status: newStatus }) });
      toast('Status updated'); navigate('dashboard'); load();
    } catch (err) { toast(err.message); }
  };
  const approve = async id => {
    try { await request(`/api/admin/pets/${id}/approve`, { method: 'POST' }); toast('Listing verified and published'); navigate('dashboard'); load(); }
    catch (err) { toast(err.message); }
  };
  const card = p => <article className="petcard" key={p.id}>
    <div className="cardphoto"><Img src={p.image} alt={p.name}/><span className="badge">Verified listing</span></div>
    <div className="cardbody"><div className="between"><h3>{p.name}</h3><span className="species">{p.species}</span></div>
      <p>{p.breed || 'Breed not confirmed'} · {p.age || 'Age unknown'}</p>
      <p className="muted"><MapPin size={14}/>{p.city}</p><p className="clamp">{p.description}</p>
      <p className="source">Listed by: {p.source}</p>
      <button className="primary full" onClick={() => apply(p)}>Apply to Adopt <Heart size={16}/></button>
    </div>
  </article>;
  const matchingPets = pets.filter(p => (!filter || p.species?.toLowerCase() === filter.toLowerCase()) && (!city || p.city?.toLowerCase().includes(city.toLowerCase())));

  return <>
    <header><div className="nav wrap">
      <button className="brand" onClick={() => navigate('home')}><span className="logo"><PawPrint size={24}/></span>PawConnect <em>AI</em></button>
      <button className="hamburger" onClick={() => setMobile(!mobile)}><Menu/></button>
      <nav className={mobile ? 'show' : ''}>
        <button onClick={() => navigate('home')}>Home</button><button onClick={() => navigate('adopt')}>Adopt</button>
        <button onClick={() => navigate('identify')}>AI Scanner</button><button onClick={() => navigate('lost')}>Lost & Found</button>
        <button onClick={() => navigate('ngo')}>NGOs</button>
        {user ? <><button onClick={() => navigate('dashboard')}>Dashboard</button><button className="navlogout" onClick={logout}><LogOut size={16}/> Logout</button></> :
          <button className="primary" onClick={() => setModal('login')}>Login / Join <ArrowRight size={16}/></button>}
      </nav>
    </div></header>

    {page === 'home' && <>
      <section className="hero"><div className="wrap hero-grid"><div>
        <span className="eyebrow">🐾 CONNECTING PAWS WITH PEOPLE</span><h1>Every pet deserves a <span>loving home.</span></h1>
        <p>Discover verified pets, report lost companions and explore AI-assisted animal identification. Built for compassionate adoption in Pune and beyond.</p>
        <div className="actions"><button className="primary big" onClick={() => navigate('adopt')}>Find a Friend <ArrowRight size={19}/></button><button className="outline big" onClick={() => navigate('identify')}><Camera size={19}/> Try AI Scanner</button></div>
        <div className="trust"><ShieldCheck size={19}/> Only verified adoption listings are published</div>
      </div><div className="heroimg"><Img src="https://images.unsplash.com/photo-1517849845537-4d257902454a?w=1100" alt="Happy rescue dog"/><div className="floatcard">❤️ <strong>Love changes lives</strong><small>Adopt, don't abandon</small></div></div></div></section>
      <section className="wrap section"><div className="sectiontitle"><span className="eyebrow">HOW IT WORKS</span><h2>Small steps. Big pawprints.</h2></div>
        <div className="features"><div><span>🏡</span><h3>Find your companion</h3><p>Browse verified pets and send a genuine adoption application.</p></div><div><span>📸</span><h3>Scan with AI</h3><p>Upload or capture an animal photo for AI-generated identification suggestions.</p></div><div><span>🔎</span><h3>Reunite families</h3><p>Post lost and found reports to help pets get home safely.</p></div></div>
      </section>
      <section className="wrap section"><div className="between heading"><div><span className="eyebrow">FIND YOUR FRIEND</span><h2>Pets looking for homes</h2></div><button className="textbutton" onClick={() => navigate('adopt')}>View all <ArrowRight size={17}/></button></div>
        {pets.length ? <div className="grid">{pets.slice(0, 3).map(card)}</div> : <div className="empty"><PawPrint size={38}/><h3>No verified pets listed yet</h3><p>We won't invent adoptable animals. Verified NGO and owner listings will appear here.</p><button className="primary" onClick={() => navigate('ngo')}>Explore NGO directory</button></div>}
      </section>
    </>}

    {page === 'adopt' && <main className="wrap section"><span className="eyebrow">MEET YOUR NEW BEST FRIEND</span><h1 className="pagetitle">Find a pet to adopt 🐾</h1><p className="intro">Only admin-approved listings appear here. Contact and availability must be reconfirmed with the listing owner.</p>
      <div className="filters"><label><Search size={18}/><input placeholder="Search city" value={city} onChange={e => setCity(e.target.value)}/></label><select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All animals</option><option>Dog</option><option>Cat</option><option>Rabbit</option><option>Other</option></select></div>
      {matchingPets.length ? <div className="grid">{matchingPets.map(card)}</div> : <div className="empty"><Dog size={42}/><h3>No matching verified listings</h3><p>Listings appear after NGO/owner submission and admin verification.</p></div>}
    </main>}

    {page === 'identify' && <main className="wrap section narrow"><span className="eyebrow">SMART PET TOOLS</span><h1 className="pagetitle">AI Animal Scanner 📸</h1>
      <p className="intro">Upload a photo to run free on-device AI classification. Some dog breeds may be suggested; exact age and cat breeds cannot be reliably determined from a photo.</p>
      <div className="panel scanner"><div className="scanicon"><Camera size={42}/></div><h2>Who is this little friend?</h2><p>Choose an animal photo (JPG/PNG, up to 5 MB)</p>
        {/* Gallery/Files picker: NO capture attribute */}
        <label className="primary big filebutton"><Upload size={19}/> {busy ? 'Analyzing...' : 'Choose Photo from Gallery'}
          <input type="file" accept="image/*" onChange={detect} disabled={busy}/>
        </label>
        {/* Separate camera option */}
        <label className="outline big filebutton" style={{ marginTop: 12 }}><Camera size={19}/> {busy ? 'Analyzing...' : 'Take Photo'}
          <input type="file" accept="image/*" capture="environment" onChange={detect} disabled={busy}/>
        </label>
      </div>
      {result && <div className="panel results"><h3>Analysis Result</h3>{result.available ? <><p className="warning">{result.warning}</p>{result.predictions?.map((x, i) => <div className="prediction" key={i}><strong>{x.label}</strong><span>{Math.round(x.score * 100)}% confidence</span></div>)}</> : <p className="warning">{result.message}</p>}</div>}
    </main>}

    {page === 'lost' && <main className="wrap section"><span className="eyebrow">BRING THEM HOME</span><h1 className="pagetitle">Lost & Found 💛</h1><p className="intro">Share a lost or found pet report. For safety, personal contact details aren't shown publicly.</p>
      <button className="primary" onClick={() => user ? navigate('report') : setModal('login')}><Plus size={17}/> Create a Report</button>
      <div className="grid space">{lost.length ? lost.map(p => <article className="petcard" key={p.id}><div className="cardphoto"><Img src={p.image} alt={p.name}/><span className="badge">{p.kind.toUpperCase()}</span></div><div className="cardbody"><h3>{p.name}</h3><p>{p.species} · {p.city}</p><p>{p.details}</p><small>To report a possible match, contact the site administrator. Do not share private information publicly.</small></div></article>) : <div className="empty"><h3>No open reports yet</h3><p>New reports will appear here.</p></div>}</div>
    </main>}

    {page === 'ngo' && <main className="wrap section"><span className="eyebrow">LOCAL ANIMAL HELP</span><h1 className="pagetitle">Animal NGOs & Shelters 🏥</h1><p className="intro">Public directory only. These organizations have not been confirmed as PawConnect partners. Call them directly to confirm current services, availability and contact details.</p>
      <div className="features ngo">{[
        { name: 'SAWO – Stray Animal Welfare Organization', place: 'Talegaon Dabhade, Pune', phone: '9158415161', url: 'https://www.sawoteam.org/' },
        { name: 'Make New Life', place: 'Kasarsai, Pune', phone: '9922819742', url: 'https://makenewlife.in/' },
        { name: 'Hope For Paws Foundation', place: 'Pusane, Maval', phone: '9604222666', url: '' },
      ].map(n => <div key={n.name}><span>🐾</span><h3>{n.name}</h3><p><MapPin size={15}/> {n.place}</p><p>Phone (please verify): {n.phone}</p>{n.url && <a className="textbutton" href={n.url} target="_blank" rel="noreferrer">Visit official website ↗</a>}</div>)}</div>
      <div className="panel space"><h3>Are you an NGO or rescue volunteer?</h3><p>Register as an NGO to submit animals for adoption. Listings require verification before publication.</p><button className="primary" onClick={() => setModal('register')}>Register as NGO</button></div>
    </main>}

    {page === 'report' && <main className="wrap section narrow"><h1 className="pagetitle">Create Lost / Found Report</h1><form className="panel form" onSubmit={submitLost}>
      <label>Report type<select name="kind"><option value="lost">Lost pet</option><option value="found">Found animal</option></select></label>
      <label>Pet name / identifier<input name="name" required/></label><label>Species<input name="species" placeholder="Dog, Cat..." required/></label>
      <label>City / last seen location<input name="city" required/></label><label>Details<textarea name="details" required placeholder="Appearance, last seen date, identifying features (avoid sharing private contact info)"/></label>
      <label>Photo<input name="photo" type="file" accept="image/*"/></label><button className="primary" disabled={busy}>{busy ? 'Submitting...' : 'Publish report'}</button>
    </form></main>}

    {page === 'add' && <main className="wrap section narrow"><h1 className="pagetitle">Submit a pet for adoption</h1><p className="intro">Only list real animals with permission. All new listings require admin approval.</p><form className="panel form" onSubmit={submitPet}>
      <label>Pet name<input name="name" required/></label><label>Species<select name="species"><option>Dog</option><option>Cat</option><option>Rabbit</option><option>Other</option></select></label>
      <label>Breed (if known)<input name="breed" placeholder="Unknown is okay"/></label><label>Age (verified or estimated)<input name="age" placeholder="e.g. Approximately 2 years"/></label>
      <label>City<input name="city" required/></label><label>NGO / owner source<input name="source" required placeholder="Name of organization or owner"/></label>
      <label>Description<textarea name="description" required placeholder="Temperament, care needs, verified vaccination info"/></label>
      <label>Real pet photo<input type="file" name="photo" accept="image/*" required/></label>
      <button className="primary" disabled={busy}>{busy ? 'Submitting...' : 'Submit for verification'}</button>
    </form></main>}

    {page === 'dashboard' && <main className="wrap section"><span className="eyebrow">YOUR SPACE</span><h1 className="pagetitle">Welcome, {user?.name} 👋</h1><p className="intro">Account type: {user?.role}</p>
      {['owner', 'ngo'].includes(user?.role) && <button className="primary" onClick={() => navigate('add')}><Plus size={18}/> Add Real Pet</button>}
      <h2 className="space">Adoption applications</h2><div className="panel">{apps.length ? apps.map(a => <div className="row" key={a.id}><div><strong>{a.pet}</strong><p>{a.message}</p><small>Status: {a.status}</small></div>{['owner', 'ngo'].includes(user?.role) && <div className="actions"><button className="outline" onClick={() => status(a.id, 'approved', 'application')}>Approve</button><button className="outline" onClick={() => status(a.id, 'rejected', 'application')}>Reject</button></div>}</div>) : <p>No applications yet.</p>}</div>
      {['owner', 'ngo'].includes(user?.role) && <><h2 className="space">Your pet listings</h2><div className="panel">{myPets.length ? myPets.map(p => <div className="row" key={p.id}><div><strong>{p.name}</strong><p>{p.city} · Status: {p.status}</p></div>{p.status === 'available' && <button className="outline" onClick={() => status(p.id, 'adopted', 'pet')}>Mark adopted</button>}</div>) : <p>No listings submitted yet.</p>}</div></>}
      {pending.length > 0 && <><h2 className="space">Admin: Listings awaiting verification</h2><div className="panel">{pending.map(p => <div className="row" key={p.id}><div><strong>{p.name} — {p.source}</strong><p>{p.city} · {p.description}</p>{p.image && <a href={p.image.startsWith('/') ? API + p.image : p.image} target="_blank" rel="noreferrer">View photo</a>}</div><button className="primary" onClick={() => approve(p.id)}>Approve (verify first)</button></div>)}</div></>}
    </main>}

    <footer><div className="wrap foot"><div><div className="brand"><span className="logo"><PawPrint size={20}/></span>PawConnect <em>AI</em></div><p>Real connections. Responsible adoption. A safer way to help animals.</p></div><div><strong>Explore</strong><button onClick={() => navigate('adopt')}>Adopt</button><button onClick={() => navigate('lost')}>Lost & Found</button><button onClick={() => navigate('ngo')}>NGOs</button></div><div><strong>Transparency</strong><p>No invented adoption listings.<br/>AI predictions are not veterinary advice.<br/>NGOs listed are not official partners.</p></div></div><div className="copyright">© {new Date().getFullYear()} PawConnect AI · Made with care 🐾</div></footer>

    {modal && <div className="overlay" onClick={() => setModal(null)}><div className="auth panel" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setModal(null)}>✕</button><h2>{modal === 'login' ? 'Welcome back!' : 'Join PawConnect AI'}</h2><p>{modal === 'login' ? 'Log in to apply, report or manage pets.' : 'Create your free account.'}</p>
      <form className="form" onSubmit={auth}>{modal === 'register' && <label>Full name<input name="name" required minLength="2"/></label>}
        <label>Email<input type="email" name="email" required/></label><label>Password<input type="password" name="password" required minLength="8"/></label>
        {modal === 'register' && <label>I am a<select name="role"><option value="adopter">Pet adopter</option><option value="owner">Pet owner / rescue volunteer</option><option value="ngo">NGO / Shelter</option></select></label>}
        <button className="primary full">{modal === 'login' ? 'Log in' : 'Create account'}</button>
      </form><p className="switch">{modal === 'login' ? 'New here?' : 'Already registered?'} <button onClick={() => setModal(modal === 'login' ? 'register' : 'login')}>{modal === 'login' ? 'Create account' : 'Log in'}</button></p>
    </div></div>}
    {msg && <div className="toast"><AlertCircle size={18}/>{msg}</div>}
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
