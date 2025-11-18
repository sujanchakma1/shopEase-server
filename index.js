const express = require("express");
const app = express();
const cors = require("cors");
const port = 3000;
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middleware
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send("Welcome to shopeEase server");
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ra0uaai.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const productsCollection = client.db("shopeEase").collection("products");
    const usersCollection = client.db("shopeEase").collection("users");
    const cartCollection = client.db("shopeEase").collection("cartProducts");

    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) {
        return res
          .status(200)
          .send({ message: "user already exist", inserted: false });
      }

      const result = await usersCollection.insertOne(user);
      res.send({
        message: "User inserted successfully",
        inserted: true,
        data: result,
      });
    });

    app.get("/products", async (req, res) => {
      try {
        let { category, search, page = 1, limit = 12 } = req.query;

        page = parseInt(page);
        limit = parseInt(limit);

        const query = {};

        if (category && category.toLowerCase() !== "all") {
          query.category = { $regex: `^${category}$`, $options: "i" };
        }

        if (search) {
          query.name = { $regex: search, $options: "i" };
        }

        const skip = (page - 1) * limit;

        const products = await productsCollection
          .find(query)
          .skip(skip)
          .limit(limit)
          .toArray();

        const total = await productsCollection.countDocuments(query);

        res.send({
          products,
          total,
          page,
          totalPages: Math.ceil(total / limit),
        });
      } catch (error) {
        console.error("❌ Error fetching products:", error);
        res.status(500).send({ message: "Error fetching products", error });
      }
    });

    app.post("/cartProduct", async (req, res) => {
      try {
        const product = req.body;
        const result = await cartCollection.insertOne(product);
        // Respond with the real insertedId
        res.send({ insertedId: result.insertedId });
      } catch (error) {
        console.error("Error inserting cart product:", error);
        res.status(500).send({ error: "Failed to add product to cart" });
      }
    });
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`shopeEase server running on port ${port}`);
});
