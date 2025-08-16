const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const connectToDatabase = require('./db_connect');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Connect to MongoDB
connectToDatabase()
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((error) => {
    console.error('Error initializing database:', error);
  });


// Movie Schema for Mongoose
const movieSchema = new mongoose.Schema({
  title: { type: String, required: true },
  language: { type: String, required: true },
  poster: { type: String, required: true },
  trailer: { type: String, required: true },
  duration: { type: Number, required: true },
  rating: { type: Number, required: true },
  theaters: {
    type: [
      {
        theaterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Theatre' },
        showTimes: { type: [String] },
      },
    ],
    default: [],
  },
});
const Movie = mongoose.model('Movie', movieSchema);


// Theatre Schema for Mongoose
const theatreSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: { type: String, required: true },
  current_movie: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', default: null },
});
const Theatre = mongoose.model('Theatre', theatreSchema);


const seatBook = new mongoose.Schema({
  theatreId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Theatre' }, // Use ObjectId
  date: { type: Date, required: true },
  current_movie: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', default: null },
  showtimes: {
    type: [{
      time: { type: String, required: true }, // e.g., "12:00 PM"
      seating: {
        type: [[Boolean]], // 2D array indicating booked (true) or free (false) seats
        default: Array.from({ length: 10 }, () => Array(20).fill(false)), // 10 rows (A-J) and 20 columns (1-20)
      },
    }],
    default: [],
  },
});
const Seats = mongoose.model('Seats', seatBook);


const adminSchema = new mongoose.Schema({
  password: {
    type: String,
    required: true,
  },
});

const Admin = mongoose.model('Admin', adminSchema);



app.get('/admin/password', async (req, res) => {
  try {
    console.log("Password called ");
    const admin = await Admin.findOne();
    if (!admin) {
      return res.status(404).json({ message: 'Admin password not found' });
    }
    console.log("Password is: ", admin.password)
    res.json({ password: admin.password });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Update the admin password
app.put('/admin/password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Old and new password are required' });
  }

  try {
    const admin = await Admin.findOne();
    if (!admin) {
      return res.status(404).json({ message: 'Admin password not found' });
    }

    // Verify old password
    if (admin.password !== oldPassword) {
      return res.status(401).json({ message: 'Old password is incorrect' });
    }

    // Update password
    admin.password = newPassword;
    await admin.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});




// Route to add a new movie
app.post('/movies/add', async (req, res) => {
  console.log('Invoking /movies/add route');
  try {
    console.log('Received request body:', req.body);
    const { title, language, duration, rating, posterPath, trailerPath } = req.body;

    if (!posterPath || !trailerPath) {
      return res.status(400).send({ error: 'Poster and trailer paths are required' });
    }

    const newMovie = new Movie({
      title,
      language,
      poster: posterPath,
      trailer: trailerPath,
      duration: parseInt(duration, 10),
      rating: parseFloat(rating),
    });

    await newMovie.save();
    res.status(201).send({ message: 'Movie added successfully' });
  } catch (error) {
    console.error('Error adding movie:', error);
    res.status(500).send({ error: 'Error adding movie' });
  }
});

// Route to add a new theatre
app.post('/theatres/add', async (req, res) => {
  console.log('Invoking /theatres/add route');
  try {
    console.log('Received request body:', req.body);

    const { name, location } = req.body;

    const newTheatre = new Theatre({
      name,
      location,
    });

    await newTheatre.save();
    res.status(201).send({ message: 'Theatre added successfully' });
  } catch (error) {
    console.error('Error adding theatre:', error);
    res.status(500).send({ error: 'Error adding theatre' });
  }
});

// Route to fetch top 9 movies
app.use('/top-movies', async (req, res) => {
  try {
    const topMovies = await Movie.find().limit(9); // Fetch top 9 movies
    res.status(200).send(topMovies);
  } catch (error) {
    console.error('Error fetching top movies:', error);
    res.status(500).send({ error: 'Error fetching top movies' });
  }
});


// Route to fetch all movies
app.get('/all-movies', async (req, res) => {
  try {
    const movies = await Movie.find().select('title poster');
    res.json(movies);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching movies' });
  }
});

// Route to fetch all theatres with empty current_movie
app.get('/empty-theatre', async (req, res) => {
  try {
    const theatres = await Theatre.find({ current_movie: null });
    res.json(theatres);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching theatres' });
  }
});

// Route to update movie in a theatre
app.post('/allocate-theatre', async (req, res) => {
  const { movieId, theatreIds } = req.body;

  try {
    if (theatreIds.length === 0) {
      return res.status(400).json({ message: 'No theatres provided.' });
    }

    const theaterObjectIds = theatreIds.map(id => new mongoose.Types.ObjectId(id));

    await Movie.updateOne(
      { _id: movieId },
      { 
        $addToSet: { 
          theaters: { 
            $each: theaterObjectIds.map(id => ({ theaterId: id, showTimes: ['12pm', '3pm', '6pm', '9pm'] })) 
          }
        }
      }
    );

    await Theatre.updateMany(
      { _id: { $in: theaterObjectIds } },
      { $set: { current_movie: movieId } }
    );

    res.json({ message: 'Theatres allocated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error allocating theatres' });
  }
});


// Route to fetch theatres allocated to a specific movie
app.get('/movie-theatres/:movieId', async (req, res) => {
  const movieId = req.params.movieId;

  try {
    const movie = await Movie.findById(movieId).populate('theaters.theaterId');
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const theatres = movie.theaters.map(theater => ({
      _id: theater.theaterId._id,
      name: theater.theaterId.name,
      location: theater.theaterId.location
    }));
    res.json(theatres);
  } catch (error) {
    console.error('Error fetching theatres for movie:', error);
    res.status(500).json({ message: 'Error fetching theatres for movie' });
  }
});

// Route to deallocate theatres from a movie
app.post('/deallocate-theatre', async (req, res) => {
  const { movieId, theatreIds } = req.body;

  try {
    if (theatreIds.length === 0) {
      return res.status(400).json({ message: 'No theatres provided for deallocation' });
    }

    const theatreObjectIds = theatreIds.map(id => new mongoose.Types.ObjectId(id));

    // Remove theatres from the movie's theaters array
    await Movie.updateOne(
      { _id: movieId },
      { $pull: { theaters: { theaterId: { $in: theatreObjectIds } } } }
    );

    // Set the current_movie field in the Theatre collection back to null
    await Theatre.updateMany(
      { _id: { $in: theatreObjectIds } },
      { $set: { current_movie: null } }
    );

    res.json({ message: 'Theatres deallocated successfully' });
  } catch (error) {
    console.error('Error deallocating theatres:', error);
    res.status(500).json({ message: 'Error deallocating theatres' });
  }
});

// Route to delete a movie and update theaters
app.delete('/delete-movie/:movieId', async (req, res) => {
  const movieId = req.params.movieId;

  try {
    // Find the movie and get its associated theaters
    const movie = await Movie.findById(movieId).populate('theaters.theaterId');
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const theaters = movie.theaters.map(theater => theater.theaterId);

    // Delete the movie from the database
    await Movie.deleteOne({ _id: movieId });

    // Update all theaters that had this movie
    await Theatre.updateMany(
      { _id: { $in: theaters } },
      { $set: { current_movie: null } }
    );

    res.json({ message: 'Movie and associated theaters updated successfully' });
  } catch (error) {
    console.error('Error deleting movie and updating theaters:', error);
    res.status(500).json({ message: 'Error deleting movie and updating theaters' });
  }
});


// Route to fetch movie details by movieId
app.get('/movie-details/:movieId', async (req, res) => {
  const movieId = req.params.movieId;

  try {
    const movie = await Movie.findById(movieId);
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    // Send movie details
    res.json({
      title: movie.title,
      poster: movie.poster,
      trailer: movie.trailer,
      rating: movie.rating,
    });
  } catch (error) {
    console.error('Error fetching movie details:', error);
    res.status(500).json({ message: 'Error fetching movie details' });
  }
});

// Route to update the movie's rating
app.post('/movie-rating/:movieId', async (req, res) => {
  const movieId = req.params.movieId;
  const { rating } = req.body;

  try {
    const movie = await Movie.findById(movieId);
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    // Update the rating of the movie
    movie.rating = ( (movie.rating + rating)/2 ).toFixed(2) ;
    await movie.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating movie rating:', error);
    res.status(500).json({ message: 'Error updating movie rating' });
  }
});


app.get('/theatres/:theatreId', async (req, res) => {
  try {
      const { theatreId } = req.params;
      const theatre = await Theatre.findById(theatreId);

      if (!theatre) {
          return res.status(404).json({ message: 'Theater not found' });
      }

      res.json({ name: theatre.name, location: theatre.location });
  } catch (error) {
      console.error('Error fetching theatre details:', error);
      res.status(500).json({ message: 'Error fetching theatre details' });
  }
});



const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
      user: 'kannadarajyothsava7@gmail.com',
      pass: 'ochw amdk oyat rqrn' // Replace with your actual App Password
  }
});

app.post('/sendBookingDetails', async (req, res) => {
  const { name, email, date, theater, showTime, seats, totalPrice } = req.body;

  try {
      // Generate QR Code
      const qrData = `Name: ${name}\nEmail: ${email}\nDate: ${date}\nTheater: ${theater}\nShow Time: ${showTime}\nSeats: ${seats}\nTotal Price: ${totalPrice}`;
      const qrCode = await QRCode.toDataURL(qrData);

      // Decode the base64 QR code to a buffer for attachment
      const qrCodeBuffer = Buffer.from(qrCode.split(",")[1], "base64");

      // Send Email
      const mailOptions = {
          from: 'kannadarajyothsava7@gmail.com',
          to: email,
          subject: 'Your Booking Details',
          html: `
              <h2>Booking Confirmation</h2>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Theater:</strong> ${theater}</p>
              <p><strong>Date:</strong> ${date}</p>
              <p><strong>Show Time:</strong> ${showTime}</p>
              <p><strong>Seats:</strong> ${seats}</p>
              <p><strong>Total Price:</strong> ${totalPrice}</p>
              <p>Your QR code is attached below:</p>
          `,
          attachments: [
              {
                  filename: 'QRCode.png',
                  content: qrCodeBuffer,
                  contentType: 'image/png'
              }
          ]
      };

      await transporter.sendMail(mailOptions);
      res.json({ success: true });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ success: false, error: 'Failed to send booking details.' });
  }
});



app.post('/book-seats', async (req, res) => {
  const { movieId, theatreId, date, showTime, seatNumbers } = req.body;
  console.log("Book seat called : ", movieId, theatreId, date, showTime)
  console.log(seatNumbers)
  try {
    // Validate the date
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Please provide a valid date.' });
    }

    // Convert theatreId to ObjectId
    // const theatreObjectId = new mongoose.Types.ObjectId(theatreId);

    // Find or create the theatre document
    let theatre = await Seats.findOne({ theatreId: theatreId, date: parsedDate, current_movie: movieId });

    if (!theatre) {
      theatre = new Seats({
        theatreId: theatreId,
        current_movie: movieId,
        date: parsedDate,
        showtimes: []
      });
    }

    // Find the showtime entry
    let showtimeEntry = theatre.showtimes.find(show => show.time === showTime);

    if (!showtimeEntry) {
      // If showtime doesn't exist, create a new one
      showtimeEntry = {
        time: showTime,
        seating: Array.from({ length: 10 }, () => Array(20).fill(false)) // 10 rows (A-J) and 20 columns (1-20)
      };
      theatre.showtimes.push(showtimeEntry);
    }

    const seatRows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const rowLetterToIndex = seatRows.reduce((acc, row, index) => {
      acc[row] = index;
      return acc;
    }, {});

    // Check if requested seats are available
    for (const seat of seatNumbers) {
      const row = seat[0]; // first character (e.g., 'A')
      const col = parseInt(seat.slice(1)) - 1; // parse column (e.g., 1 to 0 index)

      if (showtimeEntry.seating[rowLetterToIndex[row]][col]) {
        return res.status(400).json({ message: `${seat} is already booked.`});
      }
    }

    // Mark those seats as booked
    for (const seat of seatNumbers) {
      const row = seat[0];
      const col = parseInt(seat.slice(1)) - 1;
      showtimeEntry.seating[rowLetterToIndex[row]][col] = true;
    }

    // Save the updated theatre document
    await theatre.save();

    res.json({ message: 'Seats booked successfully' });
  } catch (error) {
    console.error('Error booking seats:', error);
    res.status(500).json({ message: 'Error booking seats' });
  }
});

app.get('/seating-status', async (req, res) => {
  console.log("Seating status called");
  const { movieId, theatreId, date, showTime } = req.query;

  try {
    // Log the query parameters for debugging
    console.log("Query Parameters:", { movieId, theatreId, date, showTime });

    // Validate the date
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Please provide a valid date.' });
    }

    // Find the document using movieId, theatreId, and date
    const theatre = await Seats.findOne({
      theatreId: theatreId,
      current_movie: movieId,
      date: parsedDate,
    });


    // If the document doesn't exist, return a default seating matrix
    if (!theatre) {
      const defaultSeating = Array.from({ length: 10 }, () => Array(20).fill(false));
      return res.json({ showtime: showTime, seatingStatus: defaultSeating });
    }

    // Find the showtime entry
    const showtimeEntry = theatre.showtimes.find(show => show.time === showTime);
    // If the showtime entry doesn't exist, return a default seating matrix
    if (!showtimeEntry) {
      const defaultSeating = Array.from({ length: 10 }, () => Array(20).fill(false));
      return res.json({ showtime: showTime, seatingStatus: defaultSeating });
    }

    // Return the seating matrix
    res.json({ showtime: showTime, seatingStatus: showtimeEntry.seating });
  } catch (error) {
    console.error('Error fetching seating status:', error);
    res.status(500).json({ message: 'Error fetching seating status' });
  }
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
