import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  PawPrint, Heart, Camera, Search, MapPin,
  ShieldCheck, LogOut, Plus, Menu, ArrowRight,
  Upload, Dog, AlertCircle
} from 'lucide-react';
import './style.css';

const API = (
  import.meta.env.VITE_API_URL || 'http://localhost:8000'
).replace(/\/$/, '');

async function request(path, opts = {}) {
  const token = localStorage.getItem('pawtoken');

  const res = await fetch(API + path, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...opts.headers
    }
  });

  const json = await res.json().catch(() => ({
    detail: 'Request failed'
  }));

  if (!res.ok) {
    throw Error(
      typeof json.detail === 'string'
        ? json.detail
        : 'Request failed'
    );
  }

  return json;
}

const Img = ({ src, ...props }) => (
  <img
    src={
      src?.startsWith('/uploads/')
        ? API + src
        : src ||
          'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=900'
    }
    {...props}
  />
);

function App() {
  const [page, setPage] = useState('home');
  const [pets, setPets] = useState([]);
  const [lost, setLost] = useState([]);

  const [user, setUser] = useState(
    JSON.parse(localStorage.getItem('pawuser') || 'null')
  );

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

  const toast = (t) => {
    setMsg(t);
    setTimeout(() => setMsg(''), 5000);
  };

  const load = () => {
    request('/api/pets')
      .then(setPets)
      .catch(() => {});

    request('/api/lost')
      .then(setLost)
      .catch(() => {});
  };

  useEffect(load, []);

  const navigate = (p) => {
    setPage(p);
    setMobile(false);
    window.scrollTo(0, 0);

    if (p === 'dashboard' && user) {
      request('/api/applications')
        .then(setApps)
        .catch((e) => toast(e.message));

      request('/api/my/pets')
        .then(setMyPets)
        .catch(() => {});

      request('/api/admin/pending')
        .then(setPending)
        .catch(() => {});
    }
  };

  const logout = () => {
    localStorage.removeItem('pawtoken');
    localStorage.removeItem('pawuser');
    setUser(null);
    navigate('home');
  };

  const auth = async (e) => {
    e.preventDefault();

    const f = Object.fromEntries(
      new FormData(e.currentTarget)
    );

    try {
      if (modal === 'register') {
        await request('/api/register', {
          method: 'POST',
          body: JSON.stringify(f)
        });

        toast('Account created. Please log in.');
        setModal('login');
      } else {
        const d = await request('/api/login', {
          method: 'POST',
          body: JSON.stringify(f)
        });

        localStorage.setItem('pawtoken', d.token);
        localStorage.setItem('pawuser', JSON.stringify(d.user));

        setUser(d.user);
        setModal(null);
        toast('Welcome back, ' + d.user.name);
      }
    } catch (e) {
      toast(e.message);
    }
  };

  const submitPet = async (e) => {
    e.preventDefault();
    setBusy(true);

    const form = e.currentTarget;

    try {
      const f = Object.fromEntries(new FormData(form));

      if (f.photo?.size) {
        const fd = new FormData();
        fd.append('file', f.photo);

        f.image = (
          await request('/api/upload', {
            method: 'POST',
            body: fd
          })
        ).url;
      }

      delete f.photo;

      await request('/api/pets', {
        method: 'POST',
        body: JSON.stringify(f)
      });

      toast('Pet submitted for verification.');
      form.reset();
      load();
      navigate('dashboard');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitLost = async (e) => {
    e.preventDefault();
    setBusy(true);

    const form = e.currentTarget;

    try {
      const f = Object.fromEntries(new FormData(form));

      if (f.photo?.size) {
        const fd = new FormData();
        fd.append('file', f.photo);

        f.image = (
          await request('/api/upload', {
            method: 'POST',
            body: fd
          })
        ).url;
      }

      delete f.photo;

      await request('/api/lost', {
        method: 'POST',
        body: JSON.stringify(f)
      });

      toast('Report published');
      form.reset();
      load();
      navigate('lost');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const detect = async (e) => {
    const file = e.target.files?.[0];

    if (!file) return;

    setBusy(true);
    setResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const data = await request('/api/identify', {
        method: 'POST',
        body: fd
      });

      setResult(data);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (p) => {
    if (!user) {
      setModal('login');
      return;
    }

    const message = prompt(
      'Tell the NGO/owner why you would be a good adopter (minimum 10 characters):'
    );

    if (!message) return;

    try {
      await request('/api/applications', {
        method: 'POST',
        body: JSON.stringify({
          pet_id: p.id,
          message
        })
      });

      toast('Application submitted successfully');
    } catch (e) {
      toast(e.message);
    }
  };

  const status = async (id, newStatus, type) => {
    try {
      const path =
        type === 'pet'
          ? `/api/pets/${id}/status`
          : `/api/applications/${id}/status`;

      await request(path, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus })
      });

      toast('Status updated');
      navigate('dashboard');
      load();
    } catch (e) {
      toast(e.message);
    }
  };

  const approve = async (id) => {
    try {
      await request(`/api/admin/pets/${id}/approve`, {
        method: 'POST'
      });

      toast('Listing verified and published');
      navigate('dashboard');
      load();
    } catch (e) {
      toast(e.message);
    }
  };

  const card = (p) => (
    <article className="petcard" key={p.id}>
      <div className="cardphoto">
        <Img src={p.image} alt={p.name} />
        <span className="badge">Verified listing</span>
      </div>

      <div className="cardbody">
        <div className="between">
          <h3>{p.name}</h3>
          <span className="species">{p.species}</span>
        </div>

        <p>
          {p.breed || 'Breed not confirmed'} ·{' '}
          {p.age || 'Age unknown'}
        </p>

        <p className="muted">
          <MapPin size={14} />
          {p.city}
        </p>

        <p className="clamp">{p.description}</p>

        <p className="source">
          Listed by: {p.source}
        </p>

        <button
          className="primary full"
          onClick={() => apply(p)}
        >
          Apply to Adopt <Heart size={16} />
        </button>
      </div>
    </article>
  );

  // PART 2 CODE GOES HERE
