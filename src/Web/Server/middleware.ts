import {Request, Response} from "express";

export const authUserCheck = (userRequired = true) => async (req: Request, res: Response, next: Function) => {
    if (req.isAuthenticated()) {
        if (userRequired && req.user.machine === true) {
            return res.status(403).json({message: 'Must be authenticated as a user to access this route'});
        }
        next();
    } else {
        return res.status(401).json('Must be authenticated to access this route');
    }
}
