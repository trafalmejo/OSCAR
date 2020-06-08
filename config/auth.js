module.exports = {
    ensureAuthenticated: function(req, res, next) {
        if(req.isAuthenticated()){
            return next()
        }
        //req.flash('error_message', 'Please Log In to see this resource')
        res.json({errors: "Please Log In"})
    },
    isLoggedIn: function(req, res, next) {
        if(req.isAuthenticated()){
            res.redirect('/')
        }
    }
}