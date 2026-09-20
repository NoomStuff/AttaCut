import { faHeart, faScissors } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button, Modal } from "./Controls";

const repositoryUrl = "https://github.com/NoomStuff/AttaCut";
const licenseUrl = "https://opensource.org/licenses/MIT";
const websiteUrl = "https://noomstuff.com";

export function AboutPanel({ version, onClose }: { version: string; onClose: () => void }) {
   const open = (url: string) => void window.desktop.openExternal(url).catch(() => {});
   return (
      <Modal title="About" onClose={onClose} className="about-modal">
         <div className="modal-body about-body">
            <div className="about-head">
               <div className="about-mark" aria-hidden="true">
                  <FontAwesomeIcon icon={faScissors} />
               </div>
               <div>
                  <h3>AttaCut</h3>
                  <p>Version {version}</p>
               </div>
            </div>
            <p className="about-tagline">Cut your clips, move on.</p>
            <p>A trimmer for getting clips out of a recording with as little effort as possible. Mark the ranges you want to keep, then export them.</p>
            <p>
               The name comes from <strong>Atta</strong>, a genus of leafcutter ants known for cutting leaves with remarkable precision.
            </p>
            <div className="about-links">
               <Button
                  variant="secondary"
                  onClick={() => {
                     open(repositoryUrl);
                  }}
               >
                  GitHub
               </Button>
               <Button
                  variant="secondary"
                  onClick={() => {
                     open(licenseUrl);
                  }}
               >
                  MIT License
               </Button>
               <Button
                  variant="secondary"
                  onClick={() => {
                     void window.desktop.openNotices().catch(() => {});
                  }}
               >
                  Third-party notices
               </Button>
            </div>
         </div>
         <div className="about-footer">
            Vibe-coded with <FontAwesomeIcon icon={faHeart} className="about-heart" /> by{" "}
            <button
               className="about-link"
               onClick={() => {
                  open(websiteUrl);
               }}
            >
               NoomStuff
            </button>
         </div>
      </Modal>
   );
}
