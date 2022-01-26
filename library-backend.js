const { ApolloServer, UserInputError, gql } = require('apollo-server')
const core = require('apollo-server-core')
const mongoose = require("mongoose")
const jwt = require('jsonwebtoken')
const { PubSub } = require('graphql-subscriptions')
const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')
require('dotenv').config()
const pubSub = new PubSub()

const MONGODB_URI = `mongodb+srv://latrell_admin:${process.env.MONGO_DB_PASSWORD}@cluster0.8d7xk.mongodb.net/fsographql?retryWrites=true&w=majority`
const JWT_SECRET = process.env.JWT_SECRET

console.log('connecting to', MONGODB_URI)

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connection to MongoDB:', error.message)
  })

/*
 * Suomi:
 * Saattaisi olla järkevämpää assosioida kirja ja sen tekijä tallettamalla kirjan yhteyteen tekijän nimen sijaan tekijän id
 * Yksinkertaisuuden vuoksi tallennamme kuitenkin kirjan yhteyteen tekijän nimen
 *
 * English:
 * It might make more sense to associate a book with its author by storing the author's id in the context of the book instead of the author's name
 * However, for simplicity, we will store the author's name in connection with the book
*/

const typeDefs = gql`
  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }

  type Subscription {
    bookAdded: Book!
  }

  type Author {
      name: String!
      id: ID!
      bookCount: Int
      born: Int
  }

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }
  
  type Token {
    value: String!
  }

  type Query {
      bookCount: Int!
      authorCount: Int!
      allBooks(
          author: String
          genre: String
        ): [Book!]!
      allAuthors: [Author!]!
      me: User
  }

  type Mutation {
      addBook(
          title: String!
          author: String!
          published: Int!
          genres: [String!]!
      ): Book
      editAuthor(
          name: String!
          setBornTo: Int!
      ): Author
      createUser(
        username: String!
        favoriteGenre: String!
      ): User
      login(
        username: String!
        password: String!
      ): Token
  }
`

const resolvers = {
  Query: {
      bookCount: () => Book.collection.countDocuments(),
      authorCount: () => Author.collection.countDocuments(),
      allBooks: async (root, args) => {

        if (args.genre) {
          return Book.find({ genres: { $in: [args.genre] } }).populate('author')
        }
  
        return Book.find({}).populate('author')
          
      },
      allAuthors: async () => await Author.find({}),
      me: (root, args, context) => {
        console.log("current user", context.currentUser)
        return context.currentUser
      }
  },
  Author: {
    bookCount: async (root) => {
      const foundAuthor = await Author.findOne({ name: root.name })
      const foundBooks = await Book.find({ author: foundAuthor.id }) 
      return foundBooks.length
    }
  },
  Mutation: {
    addBook: async (root, args, context) => {
      const currentUser = context.currentUser
      const author = new Author({ name: args.author, born: null })
      const book = new Book({ ...args, author: author })

      if (!currentUser) {
        throw new AuthenticationError("not authenticated")
      }

      if (book.title.length < 2) {
        throw new UserInputError("book title too short")
      }
      if (book.author.length < 4) {
        throw new UserInputError("author name too short")
      }
        
      try {
        await author.save()
        await book.save()
        console.log("saving author ", author)
        console.log("saving book ", book)
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }

      pubSub.publish('BOOK_ADDED', { bookAdded: book })

      return book
    },
    editAuthor: async (root, args, context) => {
      const currentUser = context.currentUser
      if (!currentUser) {
        throw new AuthenticationError("not authenticated")
      }

      const author = await Author.findOne({ name: args.name })
      
      if (!author) {
          return null
      }

      author.overwrite({ name: args.name, born: args.setBornTo })
      await author.save()
      return author
    },
    createUser: (root, args) => {
      const user = new User({ 
        username: args.username, 
        favoriteGenre: args.favoriteGenre 
      })

      
  
      return user.save()
        .catch(error => {
          console.log(user)
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        })
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username })
  
      if ( !user || args.password !== 'secret' ) {
        throw new UserInputError("wrong credentials")
      }
  
      const userForToken = {
        username: user.username,
        id: user._id,
      }
  
      return { value: jwt.sign(userForToken, JWT_SECRET) }
    }
  },
  Subscription: {
    bookAdded: {
      subscribe: () => pubSub.asyncIterator(['BOOK_ADDED'])
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [
      core.ApolloServerPluginLandingPageGraphQLPlayground(),
    ],
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null
    if (auth.toLowerCase().startsWith('bearer ')) {
      const decodedToken = jwt.verify(
        auth.substring(7), JWT_SECRET
      )
      const currentUser = await User.findById(decodedToken.id)
      return { currentUser }
    }
  }
})

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subscriptions ready at ${subscriptionsUrl}`)
})