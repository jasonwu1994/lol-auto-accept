const AuthReducer = (prevState = {
  auth: {
    protocol: 'https',
    address: '127.0.0.1',
    port: 9527,
    username: 'jasonwu1994',
    password: 'jasonwu1994'
  }
}, action) => {
  // console.log("AuthReducer ",action)
  let newState = {...prevState}
  switch (action.type) {
    case "change-auth":
      newState.auth = action.data
      return newState
    default:
      return prevState
  }
}

export default AuthReducer