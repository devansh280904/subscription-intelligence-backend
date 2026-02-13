import express from 'express';
import routes from './routes';
import gmailRoutes from './modules/gmail/gmail.routes'
import cors from 'cors';
import { errorHandler } from './middlewares/error.middleware';

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
   app.use(errorHandler); // Add at the end, after all routes
//middleware to parse json bodies
app.use(express.json());

app.get('/auth/callback', (req, res) => {
  const code = req.query.code;

  res.json({
    message: 'OAuth callback received successfully',
    code
  });
});

app.use('/api', routes);
app.use('/gmail', gmailRoutes)

export default app