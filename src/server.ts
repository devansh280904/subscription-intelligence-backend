import 'dotenv/config';
import app from './app/app';

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Yay! Our Server is Running on ${PORT}`);
})
