require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const port = 3000;
const stripe = require("stripe")(`${process.env.STRIPE_SECRET_KEY}`);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");

// middleware
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send("Welcome to shopeEase server");
});

const VerifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) return res.status(401).send({ message: "Unauthorized" });

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: "Invalid token" });

    req.decoded = decoded; // 🔥 id, email, role
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ra0uaai.mongodb.net/?appName=Cluster0`;

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
    const orderCollection = client.db("shopeEase").collection("ordered");
    const paymentCollection = client.db("shopeEase").collection("payments");

    app.post("/auth/register", async (req, res) => {
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
    app.post("/auth/login", async (req, res) => {
      const { email } = req.body;

      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(401).send({ message: "Invalid user" });

      // 🔐 JWT
      const token = jwt.sign(
        {
          id: user._id,
          email: user.email,
          role: user.role, // 🔥 critical
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.send({ token });
    });
    // GET user role
    app.get("/users/role", VerifyToken, async (req, res) => {
      const email = req.query.email;

      if (email !== req.decoded.email) {
        return res.status(403).json({ message: "Forbidden access" });
      }

      const user = await usersCollection.findOne({ email: email });

      res.json({ role: user?.role });
    });

    // Admin state
    app.get("/admin/stats", VerifyToken, async (req, res) => {
      try {
        // Optional: check if user is admin
        const adminUser = await usersCollection.findOne({
          email: req.decoded.email,
        });
        if (!adminUser || adminUser.role !== "admin") {
          return res.status(403).json({ message: "Forbidden access" });
        }

        const totalUsers = await usersCollection.countDocuments();
        const totalOrders = await orderCollection.countDocuments();
        const totalRevenueAgg = await orderCollection
          .aggregate([
            { $group: { _id: null, total: { $sum: "$totalPrice" } } },
          ])
          .toArray();
        const totalRevenue = totalRevenueAgg[0]?.total || 0;

        // Monthly Orders
        const monthlyOrdersAgg = await orderCollection
          .aggregate([
            {
              $group: {
                _id: { $month: "$createdAt" },
                orders: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        const monthlyOrders = monthlyOrdersAgg.map((item) => ({
          month: monthNames[item._id - 1],
          orders: item.orders,
        }));

        res.json({
          totalUsers,
          totalOrders,
          totalRevenue,
          monthlyOrders,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
      }
    });
    app.get("/admin/users", VerifyToken, async (req, res) => {
      const users = await usersCollection.find().toArray();

      res.json(users);
    });

    // Product
    app.post("/products", VerifyToken, async (req, res) => {
      const product = {
        ...req.body,
      };

      const result = await productsCollection.insertOne(product);
      res.json(result);
    });

    app.get("/product", async (req, res) => {
      try {
        const result = await productsCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error("❌ Error fetching products:", error);
        res.status(500).send({ message: "Error fetching products", error });
      }
    });
    app.get("/popular-products", async (req, res) => {
      try {
        const result = await productsCollection
          .find()
          .sort({ orderCount: -1 }) // 🔥 highest first
          .limit(8)
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to load popular products" });
      }
    });

    app.get("/products", async (req, res) => {
      try {
        let { category = "all", search = "", page = 1, limit = 12 } = req.query;

        page = Number(page);
        limit = Number(limit);

        const query = {};

        // ✅ Category filter
        if (category !== "all") {
          query.category = { $regex: `^${category}$`, $options: "i" };
        }

        // ✅ Search filter
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
        console.error("❌ Products Fetch Error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });
    app.get("/product/:id", VerifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await productsCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.error("❌ Error fetching products:", error);
      }
    });
    app.delete("/products/:id", VerifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.deleteOne(query);
      res.send(result);
    });
    app.patch("/products/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: updatedData,
        }
      );

      res.send(result);
    });

    // *Added to cart product

    app.post("/cart", async (req, res) => {
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

    app.get("/cart", VerifyToken, async (req, res) => {
      const email = req.query.email;
      const result = await cartCollection.find({ userEmail: email }).toArray();
      res.send(result);
    });

    app.delete("/cart/:id", VerifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await cartCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // *Ordered Product

    app.post("/order", async (req, res) => {
      try {
        const product = req.body;
        const result = await orderCollection.insertOne(product);
        // 2️⃣ Increment orderCount in product
        const updateResult = await productsCollection.updateOne(
          { _id: new ObjectId(product.productId) },
          { $inc: { orderCount: 1 } }
        );

        if (updateResult.matchedCount === 0) {
          return res.status(404).send({ error: "Product not found" });
        }
        res.send(result);
      } catch (error) {
        console.log("ordered fetching error");
        res.status(500).send({ error: "Failed to ordered" });
      }
    });

    app.get("/order/:orderId", VerifyToken, async (req, res) => {
      const id = req.params.orderId;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid order ID" });
      }

      try {
        const order = await orderCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!order) {
          return res.status(404).send({ error: "order not found" });
        }

        res.send(order);
      } catch (err) {
        console.error("Error fetching order:", err);
        res.status(500).send({ error: "Server error" });
      }
    });

    app.get("/order", VerifyToken, async (req, res) => {
      try {
        const email = req.query.email;
        console.log(email);

        if (!email) {
          return res.status(400).json({ error: "Email is required" });
        }

        const orders = await orderCollection
          .find({ customer_email: email })
          .sort({ date: -1 })
          .toArray();

        res.send(orders);
      } catch (error) {
        console.error("Orders fetch failed:", error);
        res.status(500).json({ error: "Failed to fetch orders" });
      }
    });
    app.get("/orders", VerifyToken, async (req, res) => {
      const orders = await orderCollection.find().sort({ date: -1 }).toArray();
      res.send(orders);
    });

    // Cancel Order
    app.delete("/order/:orderId", VerifyToken, async (req, res) => {
      const { orderId } = req.params;

      if (!ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      try {
        const order = await orderCollection.findOne({
          _id: new ObjectId(orderId),
        });

        if (!order) {
          return res.status(404).json({ error: "Order not found" });
        }

        if (order.payment_status === "Paid") {
          return res
            .status(400)
            .json({ error: "Cannot cancel an already paid order" });
        }

        const result = await orderCollection.deleteOne({
          _id: new ObjectId(orderId),
        });
        res.json(result);
      } catch (err) {
        console.error("Cancel order failed:", err);
        res.status(500).json({ error: "Server error" });
      }
    });
    app.patch("/order/confirm/:id", VerifyToken, async (req, res) => {
      const id = req.params.id;

      const order = await orderCollection.findOne({ _id: new ObjectId(id) });

      const result = await orderCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            confirmation_status: "confirmed",
          },
        }
      );

      res.send(result);
    });

    // *payment
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { orderId, amountInCents } = req.body;

        if (!orderId || !amountInCents) {
          return res
            .status(400)
            .json({ error: "orderId & amountInCents required" });
        }

        let objectId;
        try {
          objectId = new ObjectId(orderId);
        } catch {
          return res.status(400).json({ error: "Invalid orderId format" });
        }

        const order = await orderCollection.findOne({ _id: objectId });
        if (!order) return res.status(404).json({ error: "Order not found" });

        const expectedAmount = order.totalPrice * 100;
        if (expectedAmount !== amountInCents) {
          return res
            .status(400)
            .json({ error: "Amount mismatch. Payment blocked." });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: expectedAmount,
          currency: "usd",
          automatic_payment_methods: { enabled: true },
          metadata: {
            orderId: orderId,
            email: order.customer_email,
            customer_name: order.customer_name,
          },
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error("PaymentIntent Error:", err);
        res.status(500).json({ error: err.message });
      }
    });

    app.post("/payments", async (req, res) => {
      try {
        const { orderId, amount, customer_email, transactionId, method } =
          req.body;

        const paymentData = {
          orderId,
          amount,
          customer_email,
          transactionId,
          method,
          paid_at: new Date(),
          paid_at_string: new Date().toISOString(),
        };

        // Save payment record
        const insertResult = await paymentCollection.insertOne(paymentData);

        // Update order payment status
        await orderCollection.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { payment_status: "Paid" } }
        );

        res.send(insertResult);
      } catch (error) {
        console.error("Payment save failed:", error);
        res.status(500).send({ error: "Payment saving failed" });
      }
    });

    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
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
