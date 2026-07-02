# APRO.L - IC Group Admin Panel

Professional admin panel for managing users and viewing analytics.

## 🚀 Features

- ✓ User authentication with JWT
- ✓ Dashboard with stats
- ✓ User management (CRUD)
- ✓ Role-based access
- ✓ Responsive design
- ✓ Modern UI with Tailwind CSS

## 📦 Stack

- **React 18** - UI library
- **Vite** - Build tool
- **Zustand** - State management
- **Axios** - HTTP client
- **React Router** - Navigation
- **Lucide Icons** - Icons

## 🔧 Installation

```bash
npm install
```

## 🏃 Development

```bash
npm run dev
```

Server runs on http://localhost:5173

## 🏗️ Production Build

```bash
npm run build
```

Output in `/dist` folder

## 📝 Environment

Create `.env.local`:

```
VITE_API_URL=http://opu.ic-group.kz
```

## 🔐 Default User

- **Phone:** +77771111111
- **Password:** Pass1234!

## 📚 Project Structure

```
src/
├── pages/           # Page components
├── components/      # Reusable components
├── store.js         # Zustand store
├── api.js          # Axios setup
├── App.jsx         # Main app
└── index.css       # Global styles
```

## 🚢 Deployment

For Vercel:

```bash
npm run build
npx vercel deploy --prod
```

For custom VPS:

1. Build: `npm run build`
2. Serve `/dist` folder with Nginx/Apache
3. Setup proxy to API server

## 📖 Pages

- `/login` - Authentication
- `/` - Dashboard
- `/users` - User management

## 🔗 API Integration

API endpoints via `src/api.js`:

- `POST /api/auth/login` - Login
- `GET /api/users` - Fetch all users
- `GET /api/users/:id` - Get user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user
