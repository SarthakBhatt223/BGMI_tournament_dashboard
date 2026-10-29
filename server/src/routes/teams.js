import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { badRequest } from '../errors.js';
import { createTeam, deleteTeam, getTeam, listTeams, setTeamLogoPath, updateTeam } from '../services/rosterService.js';
import { getActiveEvent } from '../services/eventService.js';
import { parseId } from '../validation.js';

const LOGO_EXTENSION_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function createTeamsRouter({ db, commit, config }) {
  const router = express.Router();
  const eventId = () => getActiveEvent(db).id;

  router.get('/', (req, res) => {
    res.json({ teams: listTeams(db, eventId()) });
  });

  router.post('/', (req, res) => {
    const team = commit(() => createTeam(db, eventId(), req.body));
    res.status(201).json({ team });
  });

  router.get('/:id', (req, res) => {
    res.json({ team: getTeam(db, parseId(req.params.id)) });
  });

  router.patch('/:id', (req, res) => {
    const team = commit(() => updateTeam(db, parseId(req.params.id), req.body));
    res.json({ team });
  });

  router.delete('/:id', (req, res) => {
    commit(() => deleteTeam(db, parseId(req.params.id)));
    res.status(204).end();
  });

  // Raw image upload: PUT the file bytes with Content-Type image/png, image/jpeg or image/webp.
  router.put(
    '/:id/logo',
    express.raw({ type: Object.keys(LOGO_EXTENSION_BY_TYPE), limit: MAX_LOGO_BYTES }),
    (req, res) => {
      const teamId = parseId(req.params.id);
      const extension = LOGO_EXTENSION_BY_TYPE[req.get('content-type')?.split(';')[0]];
      if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw badRequest('Send the image as raw bytes with Content-Type image/png, image/jpeg or image/webp (max 2 MB).');
      }
      const previousLogoPath = getTeam(db, teamId).logoPath;

      const logosDirectory = path.join(config.mediaDirectory, 'logos');
      fs.mkdirSync(logosDirectory, { recursive: true });
      const fileName = `team-${teamId}-${Date.now()}.${extension}`;
      fs.writeFileSync(path.join(logosDirectory, fileName), req.body);

      let team;
      try {
        team = commit(() => setTeamLogoPath(db, teamId, `/media/logos/${fileName}`));
      } catch (error) {
        fs.rmSync(path.join(logosDirectory, fileName), { force: true });
        throw error;
      }
      if (previousLogoPath?.startsWith('/media/logos/')) {
        fs.rmSync(path.join(logosDirectory, path.basename(previousLogoPath)), { force: true });
      }
      res.json({ team });
    },
  );

  return router;
}
